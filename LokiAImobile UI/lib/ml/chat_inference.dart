import 'dart:async';

import 'package:fllama/fllama.dart';

import 'model_guard.dart';

/// GGUF chat inference via fllama (llama.cpp FFI).
///
/// Event schema (from the vendored fllama plugin's native side, see
/// packages/fllama/example/lib/vm/HomeVM.dart):
///   { "function": "completion",   "result": { "token": "..." } }
///   { "function": "loadProgress", "result": ... }
/// Completion end is signalled by the completion() future resolving.
class ChatInference {
  double? _contextId;
  Future<void>? _initFuture;
  String? _initError;
  StreamSubscription? _tokenSubscription;
  StreamController<String>? _activeController;
  Timer? _generationWatchdog;
  bool _generating = false;
  bool _disposed = false;

  static const Duration _firstTokenTimeout = Duration(seconds: 90);

  Future<void> initialize(String modelPath) {
    if (_disposed) {
      return Future.error(StateError('This chat runtime has been closed.'));
    }
    // Kick off async init exactly once; generateText awaits it so a user who
    // types before the model finished loading just waits instead of failing.
    _initFuture ??= _doInitialize(modelPath);
    return _initFuture!;
  }

  Future<void> _doInitialize(String modelPath) async {
    // llama.cpp aborts the process on a file it cannot use, so nothing below
    // this point can be recovered by catching. Everything that CAN be decided
    // in Dart is decided here, before native code ever sees the path.
    if (await ModelGuard.isQuarantined(modelPath)) {
      _initError =
          'This model crashed the app the last time it was opened, '
          'so LokiAI will not load it again. Deploy a different model from '
          'the dashboard.';
      // ignore: avoid_print
      print('CHAT: refusing quarantined model: $modelPath');
      return;
    }

    final rejection = await ModelGuard.validateGguf(modelPath);
    if (rejection != null) {
      _initError = rejection.message;
      // ignore: avoid_print
      print('CHAT: refusing model: $rejection');
      return;
    }

    try {
      // ignore: avoid_print
      print('CHAT: initializing GGUF model: $modelPath');
      // If the process dies inside initContext, this marker survives and the
      // next launch quarantines the file instead of crashing again.
      await ModelGuard.beginLoad(modelPath);
      final result = await Fllama.instance()?.initContext(
        modelPath,
        // Conservative Android defaults reduce native startup memory pressure.
        nCtx: 256,
        nThreads: 2,
      );
      await ModelGuard.endLoad();
      final rawId = result?['contextId'];
      if (rawId is num) {
        _contextId = rawId.toDouble();
        // ignore: avoid_print
        print('CHAT: fllama initialized, contextId=$_contextId');
      } else {
        _initError =
            'Model failed to load (no context returned). '
            'It may be incompatible with this device -- try a different '
            'model from the dashboard.';
        // ignore: avoid_print
        print('CHAT: init returned no contextId: $result');
      }
    } catch (e) {
      // A Dart-level failure is recoverable, so the marker must not outlive it
      // and quarantine a model that never actually crashed the process.
      await ModelGuard.endLoad();
      _initError =
          'Model failed to load: $e. '
          'Try a different model from the dashboard.';
      // ignore: avoid_print
      print('CHAT: init failed: $e');
    }
  }

  Stream<String> generateText(String prompt) {
    final controller = StreamController<String>();
    if (_disposed) {
      controller.add(
        'This chat model was switched while it was running. Please send again.',
      );
      controller.close();
      return controller.stream;
    }
    _generate(prompt, controller);
    return controller.stream;
  }

  Future<void> _generate(
    String prompt,
    StreamController<String> controller,
  ) async {
    // Wait for model load triggered at app start.
    final init = _initFuture;
    if (init != null) await init;

    if (_disposed || _contextId == null) {
      controller.add(
        _initError ??
            'Chat model is not loaded yet. '
                'Deploy a chat model from the dashboard.',
      );
      await controller.close();
      return;
    }
    if (_generating) {
      controller.add(
        'Still generating the previous answer -- try again in a moment.',
      );
      await controller.close();
      return;
    }
    _generating = true;
    _activeController = controller;

    var gotToken = false;
    Timer? watchdog;

    void finish() {
      watchdog?.cancel();
      if (identical(_generationWatchdog, watchdog)) {
        _generationWatchdog = null;
      }
      _tokenSubscription?.cancel();
      _tokenSubscription = null;
      _generating = false;
      if (!controller.isClosed) controller.close();
    }

    try {
      _tokenSubscription = Fllama.instance()?.onTokenStream?.listen(
        (event) {
          if (_disposed) return;
          final function = event['function'];
          if (function == 'loadProgress') return;
          if (function != 'completion') {
            // ignore: avoid_print
            print('CHAT: unexpected event: $event');
            return;
          }
          final result = event['result'];
          final token = (result is Map) ? result['token'] : null;
          if (token is String && token.isNotEmpty) {
            gotToken = true;
            if (!controller.isClosed) controller.add(token);
          }
        },
        onError: (Object err) {
          // ignore: avoid_print
          print('CHAT: token stream error: $err');
          if (!controller.isClosed) {
            controller.add('\n[Generation error: $err]');
          }
          finish();
        },
      );

      // fllama's getFormattedChat throws a ClassCastException on this version.
      // Manually constructing the ChatML template which Qwen2.5 requires.
      String systemPrompt =
          'You are Loki, a highly logical and factual AI assistant. '
          'For code and math, provide accurate, step-by-step logic and correct syntax. '
          'Do NOT hallucinate or guess; if you do not know, say so. Keep responses concise.';
      String formatted =
          '<|im_start|>system\n$systemPrompt<|im_end|>\n<|im_start|>user\n$prompt<|im_end|>\n<|im_start|>assistant\n';

      watchdog = Timer(_firstTokenTimeout, () {
        if (!_disposed && !gotToken) {
          // ignore: avoid_print
          print('CHAT: no token within ${_firstTokenTimeout.inSeconds}s');
          if (!controller.isClosed) {
            controller.add(
              'The model did not respond in time. '
              'It may be too large for this phone -- try a smaller model.',
            );
          }
          final contextId = _contextId;
          if (contextId != null) {
            unawaited(Fllama.instance()?.stopCompletion(contextId: contextId));
          }
          finish();
        }
      });
      _generationWatchdog = watchdog;

      // ignore: avoid_print
      print('CHAT: starting completion, prompt chars=${formatted.length}');
      await Fllama.instance()?.completion(
        _contextId!,
        prompt: formatted,
        nPredict: 128,
        temperature: 0.7,
        penaltyRepeat: 1.1,
        stop: ['User:', '</s>', '<|im_end|>', '<|endoftext|>'],
        emitRealtimeCompletion: true,
      );
      // ignore: avoid_print
      print('CHAT: completion finished (gotToken=$gotToken)');
      if (!gotToken && !controller.isClosed) {
        controller.add(
          'The model produced no output for this prompt. Try rephrasing.',
        );
      }
      finish();
    } catch (e) {
      // ignore: avoid_print
      print('CHAT: generation failed: $e');
      if (!controller.isClosed) controller.add('Generation failed: $e');
      finish();
    }
  }

  /// Stops a live completion before releasing native memory. Releasing a
  /// llama.cpp context while completion is still executing is a native race
  /// and was the crash when users switched from a chat model to camera/voice.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _generationWatchdog?.cancel();
    _generationWatchdog = null;
    final subscription = _tokenSubscription;
    _tokenSubscription = null;
    await subscription?.cancel();
    final controller = _activeController;
    _activeController = null;
    if (controller != null && !controller.isClosed) {
      await controller.close();
    }
    _generating = false;

    final contextId = _contextId;
    _contextId = null;
    if (contextId == null) return;
    try {
      await Fllama.instance()?.stopCompletion(contextId: contextId);
    } catch (e) {
      // A completion can have ended between cancellation and this call.
      print('CHAT: stop during dispose failed: $e');
    }
    try {
      await Fllama.instance()?.releaseContext(contextId);
    } catch (e) {
      print('CHAT: release during dispose failed: $e');
    }
  }
}
