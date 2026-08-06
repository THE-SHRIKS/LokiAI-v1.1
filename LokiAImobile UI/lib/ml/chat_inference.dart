import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:fllama/fllama.dart';

import '../diagnostics.dart';
import 'model_guard.dart';
import 'service_failure.dart';

/// The only owner of a fllama context.  A context is deliberately not shared
/// between deployed models: model metadata may stay resident, native contexts
/// may not.
enum ChatRuntimeState {
  uninitialized,
  loading,
  ready,
  generating,
  cancelling,
  switching,
  unloading,
  failed,
  disposed,
}

class ChatInference {
  static const int _contextTokens = 1024;
  static const int _batchTokens = 64;
  static const int _reservedOutputTokens = 128;
  static const Duration _firstTokenTimeout = Duration(seconds: 90);

  ChatRuntimeState _state = ChatRuntimeState.uninitialized;
  ChatRuntimeState get state => _state;
  bool get isReady => _state == ChatRuntimeState.ready;
  String? get failureMessage => _failure;
  // A machine-readable reason distinguishing WHY activation failed —
  // quarantined, structurally rejected, context-create failed, or generation
  // failed — so a caller trying several installed models in sequence (see
  // main.dart's chat-model fallback) can report the real, specific cause
  // instead of collapsing every possible failure into one generic
  // "not ready, redeploy it" message.
  String? get failureCode => _failureCode;

  /// Set when the last activation failed because the on-device inference
  /// SERVICE failed, not the model. Callers use this to avoid presenting a
  /// service fault as model incompatibility, and to avoid offering a
  /// redeploy that cannot help.
  ServiceFailure? get lastServiceFailure => _lastServiceFailure;

  /// True when the last failure was the service rather than the artifact.
  bool get failedDueToService => _lastServiceFailure != null;

  ServiceFailure? _lastServiceFailure;

  double? _contextId;
  String? _modelPath;
  String? _failure;
  String? _failureCode;
  int _epoch = 0;
  int _nextRequest = 0;
  int? _activeRequest;
  StreamSubscription<Map<Object?, dynamic>>? _tokens;
  StreamController<String>? _controller;
  Future<void>? _generationDone;
  Future<void>? _cancelDone;
  Future<void> _serial = Future<void>.value();
  Timer? _watchdog;
  bool _receivedToken = false;

  /// Loads a model after validating every failure condition that is knowable in
  /// Dart. Calls are serialized so two taps cannot allocate two contexts.
  Future<void> initialize(String modelPath) => _enqueue(() => _load(modelPath));

  Stream<String> generateText(String prompt) {
    final controller = StreamController<String>();
    unawaited(_enqueue(() => _startGeneration(prompt, controller)));
    return controller.stream;
  }

  Future<void> cancel() {
    final running = _generationDone;
    if (running == null || _contextId == null) return Future<void>.value();
    _state = ChatRuntimeState.cancelling;
    final contextId = _contextId!;
    final output = _controller;
    _invalidateRequest(); // reject tokens before asking native code to stop.
    if (output != null && !output.isClosed) unawaited(output.close());
    return _cancelDone ??= _stopAndWait(contextId, running);
  }

  /// Idempotent, ordered shutdown. This waits for completion to return before
  /// freeing memory; `releaseContext` is never allowed to race llama.cpp.
  Future<void> dispose() async {
    if (_state == ChatRuntimeState.disposed) return;
    _state = ChatRuntimeState.switching;
    _epoch++;
    await cancel();
    await _enqueue(() async {
      if (_state == ChatRuntimeState.disposed) return;
      _state = ChatRuntimeState.unloading;
      await _detachTokens();
      final contextId = _contextId;
      _contextId = null;
      _modelPath = null;
      if (contextId != null) {
        try {
          final release = await Fllama.instance()!.releaseContext(contextId);
          _log(
            'release',
            release?['operationResult']?.toString() ?? 'completed',
          );
        } catch (error, stackTrace) {
          _record('release', error, stackTrace);
        }
      }
      _state = ChatRuntimeState.disposed;
    });
  }

  Future<void> _load(String path) async {
    if (_state == ChatRuntimeState.disposed) {
      throw StateError('This chat runtime has been closed.');
    }
    if (_state == ChatRuntimeState.ready && _modelPath == path) return;
    if (_contextId != null) {
      throw StateError(
        'A chat context is already active; dispose it before loading another model.',
      );
    }
    _state = ChatRuntimeState.loading;
    _epoch++;
    final epoch = _epoch;
    _modelPath = path;
    _failure = null;
    _lastServiceFailure = null;

    if (await ModelGuard.isQuarantined(path)) {
      return _fail(
        'This model crashed LokiAI on two separate attempts to load it, so '
        "it has been disabled. Deploy a different model, or redeploy this "
        'one if you believe the file has changed.',
        code: 'MODEL_QUARANTINED',
      );
    }
    final rejection = await ModelGuard.validateGguf(path);
    if (rejection != null) return _fail(rejection.message, code: rejection.code);

    try {
      final cpu = await Fllama.instance()!.getCpuInfo();
      final cores = cpu?['cpuCount'];
      final threads = cores is num ? cores.toInt().clamp(1, 4).toInt() : 2;
      await ModelGuard.beginLoad(path);
      final result = await Fllama.instance()!.initContext(
        path,
        nCtx: _contextTokens,
        nBatch: _batchTokens,
        nThreads: threads,
        nGpuLayers: 0,
        useMlock: false,
        useMmap: true,
      );
      await ModelGuard.endLoad(path);
      final id = result?['contextId'];
      if (_epoch != epoch || _state != ChatRuntimeState.loading) {
        if (id is num) await Fllama.instance()!.releaseContext(id.toDouble());
        return;
      }
      if (id is! num) {
        return _fail(
          'Model initialization returned no native context.',
          code: 'CHAT_CONTEXT_CREATE_FAILED',
        );
      }
      _contextId = id.toDouble();
      _state = ChatRuntimeState.ready;
      _log('load', 'ready');
    } catch (error, stackTrace) {
      // A failure of the inference SERVICE is not a failure of the model.
      // This branch must come first: the generic handler below would
      // otherwise relabel a SERVICE_DISCONNECTED as
      // CHAT_CONTEXT_CREATE_FAILED and tell the user to redeploy bytes that
      // were never the problem.
      final service = ServiceFailure.from(error);
      if (service != null) {
        // Clear the load marker WITHOUT recording a strike. The model never
        // got a fair attempt, so counting one would eventually quarantine an
        // innocent file — exactly the compounding failure the incident review
        // found.
        await ModelGuard.discardLoadAttempt(
          path,
          reason: service.code,
          evidence: service.details,
        );
        _record('load', error, stackTrace);
        _lastServiceFailure = service;
        _fail(service.userMessage, code: service.code);
        return;
      }
      await ModelGuard.endLoad(path);
      _record('load', error, stackTrace);
      // The exact native error is reported, not a generic catch-all — this
      // used to collapse EVERY possible context-creation failure (a genuine
      // one-time OOM at that instant, a truly incompatible architecture, a
      // native allocator failure) into the same "not ready, redeploy it"
      // text regardless of cause, which is exactly why the message could
      // appear for a model that had previously worked fine: the user had no
      // way to tell a transient failure from a real one.
      _fail(
        'This chat model failed to activate on this device ($error). '
        'Select another downloaded chat model, try again, or redeploy this '
        'one from the dashboard if the problem persists.',
        code: 'CHAT_CONTEXT_CREATE_FAILED',
      );
    }
  }

  Future<void> _startGeneration(
    String prompt,
    StreamController<String> output,
  ) async {
    final clean = prompt.trim();
    if (clean.isEmpty)
      return _closeWith(output, 'Please enter a message before sending.');
    if (_state != ChatRuntimeState.ready || _contextId == null) {
      return _closeWith(
        output,
        _failure ?? 'The selected chat model is not ready yet.',
      );
    }
    final contextId = _contextId!;
    final epoch = _epoch;
    final request = ++_nextRequest;
    _activeRequest = request;
    _controller = output;
    _receivedToken = false;
    _state = ChatRuntimeState.generating;
    final formatted = _format(clean);
    try {
      final tokenResult = await Fllama.instance()!.tokenize(
        contextId,
        text: formatted,
      );
      final tokenCount = (tokenResult?['tokens'] as List?)?.length;
      if (tokenCount == null ||
          tokenCount + _reservedOutputTokens > _contextTokens) {
        _state = ChatRuntimeState.ready;
        _invalidateRequest();
        return _closeWith(
          output,
          'That message is too long for this model. Please shorten it and try again.',
        );
      }
    } catch (error, stackTrace) {
      _record('tokenize', error, stackTrace, request: request);
      _state = ChatRuntimeState.ready;
      _invalidateRequest();
      return _closeWith(
        output,
        'The prompt could not be prepared for this model.',
      );
    }

    // A switch may have arrived while tokenization was running. Tokenization
    // does not generate, but starting completion after that switch would use
    // a context the switch is about to release.
    if (_epoch != epoch ||
        _state != ChatRuntimeState.generating ||
        _activeRequest != request) {
      return _closeWith(
        output,
        'The model changed before this message could start. Please send it again.',
      );
    }

    _tokens = Fllama.instance()!.onTokenStream?.listen(
      (event) {
        final eventId = event['contextId'];
        final belongsToContext =
            eventId == null ||
            eventId.toString() == contextId.toInt().toString();
        if (_epoch != epoch || _activeRequest != request || !belongsToContext)
          return;
        if (event['function'] != 'completion') return;
        final result = event['result'];
        final token = result is Map ? result['token'] : null;
        if (token is String && token.isNotEmpty && !output.isClosed) {
          _receivedToken = true;
          output.add(token);
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        _record('stream', error, stackTrace, request: request);
      },
    );

    final completion = _complete(contextId, formatted, epoch, request, output);
    _generationDone = completion;
    await completion;
  }

  Future<void> _complete(
    double contextId,
    String prompt,
    int epoch,
    int request,
    StreamController<String> output,
  ) async {
    final tokenTap = _tokens;
    // A delayed callback is filtered above. The watchdog only requests a
    // native stop; it never frees the context itself.
    _watchdog = Timer(_firstTokenTimeout, () {
      if (_epoch == epoch && _activeRequest == request && !_receivedToken)
        unawaited(cancel());
    });
    try {
      await Fllama.instance()!.completion(
        contextId,
        prompt: prompt,
        nPredict: _reservedOutputTokens,
        nThreads: 2,
        temperature: .7,
        penaltyRepeat: 1.1,
        stop: const ['User:', '</s>', '<|im_end|>', '<|endoftext|>'],
        emitRealtimeCompletion: true,
      );
    } catch (error, stackTrace) {
      if (_epoch == epoch && _activeRequest == request) {
        _record('completion', error, stackTrace, request: request);
        if (!output.isClosed)
          output.add('Generation failed. Please try again.');
      }
    } finally {
      _watchdog?.cancel();
      if (_epoch == epoch && _activeRequest == request) {
        _invalidateRequest();
        _state = ChatRuntimeState.ready;
        await _detachTokens(subscription: tokenTap);
        if (!output.isClosed) await output.close();
      }
      _generationDone = null;
      _cancelDone = null;
    }
  }

  Future<void> _stopAndWait(double contextId, Future<void> running) async {
    try {
      await Fllama.instance()!.stopCompletion(contextId: contextId);
    } catch (error, stackTrace) {
      _record('cancel', error, stackTrace);
    }
    await running;
  }

  Future<void> _detachTokens({
    StreamSubscription<Map<Object?, dynamic>>? subscription,
  }) async {
    final sub = subscription ?? _tokens;
    if (identical(sub, _tokens)) _tokens = null;
    await sub?.cancel();
  }

  void _invalidateRequest() {
    _activeRequest = null;
    _controller = null;
  }

  Future<void> _closeWith(
    StreamController<String> controller,
    String message,
  ) async {
    if (!controller.isClosed) controller.add(message);
    await controller.close();
  }

  String _format(String prompt) =>
      '<|im_start|>system\nYou are Loki, a highly logical and factual AI assistant. Keep responses concise.<|im_end|>\n<|im_start|>user\n$prompt<|im_end|>\n<|im_start|>assistant\n';

  void _fail(String message, {String? code}) {
    _failure = message;
    _failureCode = code;
    _state = ChatRuntimeState.failed;
    _log('load', 'failed');
  }

  Future<void> _enqueue(Future<void> Function() operation) {
    final next = _serial.then((_) => operation());
    _serial = next.catchError((_) {});
    return next;
  }

  void _log(String operation, String result) => debugPrint(
    'LOKI_RUNTIME op=$operation result=$result state=${_state.name} epoch=$_epoch model=${_modelPath?.split('/').last ?? 'none'} request=${_activeRequest ?? 'none'}',
  );

  void _record(
    String operation,
    Object error,
    StackTrace stackTrace, {
    int? request,
  }) {
    _log(operation, 'failed');
    Diagnostics.capture(
      feature: 'chat.$operation',
      error: error,
      stackTrace: stackTrace,
      correlationId: request == null ? null : 'r$request',
    );
  }
}
