import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

import '../diagnostics.dart';
import '../ml/voice_inference.dart';

/// Every state the microphone feature can be in. Fixed by section 6 of the
/// repair plan.
enum MicFeatureState {
  idle,
  requestingPermission,
  permissionDenied,
  permissionPermanentlyDenied,
  initializing,
  listening,
  processing,
  failed,
  disposed,
}

/// Owns the microphone lifecycle: permission, recorder creation, streaming,
/// inference, and disposal.
///
/// The shipped build could not record at all: `_toggleMic` dereferenced a
/// `_voiceInference` field that nothing ever assigned after native runtimes
/// stopped being created at boot, so every tap fell into the "select a voice
/// model" branch, and the two `_voiceInference!` assertions below it were live
/// null-assertion crashes for any code path that did set it. RECORD_AUDIO was
/// never requested anywhere in the app.
class MicFeatureController extends ChangeNotifier {
  MicFeatureController();

  MicFeatureState _state = MicFeatureState.idle;
  VoiceInference? _engine;
  String _statusMessage = '';
  String? _correlationId;

  bool _startInFlight = false;
  bool _disposed = false;

  /// Results are appended here for the caller to render into chat.
  final List<String> _results = <String>[];

  static const Duration _initTimeout = Duration(seconds: 15);

  MicFeatureState get state => _state;
  String get statusMessage => _statusMessage;
  String? get correlationId => _correlationId;
  bool get isListening => _state == MicFeatureState.listening;
  List<String> get results => List.unmodifiable(_results);

  /// Invoked for every transcription/classification result.
  void Function(String result)? onResult;

  void _set(MicFeatureState state, {String? message}) {
    if (_disposed) return;
    _state = state;
    if (message != null) _statusMessage = message;
    notifyListeners();
  }

  /// Starts or stops listening. Safe under rapid repeated taps: a start already
  /// in flight is ignored, and a running session is stopped rather than
  /// duplicated.
  Future<void> toggle({String? modelPath}) async {
    if (_disposed) return;
    if (_state == MicFeatureState.listening ||
        _state == MicFeatureState.processing) {
      await stop();
      return;
    }
    await start(modelPath: modelPath);
  }

  Future<void> start({String? modelPath}) async {
    if (_disposed || _startInFlight) return;
    if (_state == MicFeatureState.listening) return;
    _startInFlight = true;
    _correlationId = Diagnostics.newCorrelationId();
    try {
      await _startNow(modelPath);
    } catch (error, stackTrace) {
      final record = Diagnostics.capture(
        feature: 'mic.start',
        error: error,
        stackTrace: stackTrace,
        correlationId: _correlationId,
      );
      await _teardown();
      _set(
        MicFeatureState.failed,
        message:
            'The microphone could not start. Reference ${record.correlationId}.',
      );
    } finally {
      _startInFlight = false;
    }
  }

  Future<void> _startNow(String? modelPath) async {
    // A recorder we have nothing to do with is not worth a permission prompt.
    if (modelPath == null || !modelPath.endsWith('.tflite')) {
      _set(
        MicFeatureState.failed,
        message: 'Deploy an audio model from the dashboard to use the '
            'microphone. Text chat is unaffected.',
      );
      return;
    }

    _set(
      MicFeatureState.requestingPermission,
      message: 'Waiting for microphone permission…',
    );
    final status = await Permission.microphone.request();
    if (_disposed) return;
    if (status.isPermanentlyDenied) {
      _set(
        MicFeatureState.permissionPermanentlyDenied,
        message: 'Microphone access is blocked for LokiAI. '
            'Open Settings to allow it.',
      );
      return;
    }
    if (!status.isGranted) {
      _set(
        MicFeatureState.permissionDenied,
        message: 'Microphone permission was denied. Text chat still works.',
      );
      return;
    }

    _set(MicFeatureState.initializing, message: 'Loading the audio model…');
    final engine = VoiceInference();
    _engine = engine;

    final loadError = await engine
        .loadModel(modelPath)
        .timeout(
          _initTimeout,
          onTimeout: () => 'The audio model did not load within '
              '${_initTimeout.inSeconds}s. Try a smaller model.',
        );
    if (_disposed || !identical(_engine, engine)) {
      await engine.dispose();
      return;
    }
    if (loadError != null) {
      _engine = null;
      await engine.dispose();
      _set(MicFeatureState.failed, message: loadError);
      return;
    }

    if (!await engine.hasMicrophone()) {
      _engine = null;
      await engine.dispose();
      _set(
        MicFeatureState.failed,
        message: 'No usable microphone was reported by this device.',
      );
      return;
    }

    final startError = await engine.startListening((result) {
      // Platform callbacks can outlive the widget; never touch a disposed
      // controller from one.
      if (_disposed || !identical(_engine, engine)) return;
      _results.add(result);
      onResult?.call(result);
      notifyListeners();
    });
    if (_disposed || !identical(_engine, engine)) {
      await engine.dispose();
      return;
    }
    if (startError != null) {
      _engine = null;
      await engine.dispose();
      _set(MicFeatureState.failed, message: startError);
      return;
    }
    _set(MicFeatureState.listening, message: 'Listening…');
  }

  Future<void> stop() async {
    if (_disposed) return;
    _set(MicFeatureState.processing, message: 'Finishing up…');
    await _teardown();
    _set(MicFeatureState.idle, message: '');
  }

  /// Recording must not continue in the background, and a recorder that Android
  /// tears down under us must never be reused.
  Future<void> handleAppPaused() async {
    if (_disposed || _state != MicFeatureState.listening) return;
    await _teardown();
    _set(MicFeatureState.idle, message: 'Recording stopped in the background.');
  }

  Future<void> _teardown() async {
    final engine = _engine;
    _engine = null;
    if (engine == null) return;
    try {
      await engine.stopListening();
    } catch (e) {
      debugPrint('MIC: stopping recorder failed: $e');
    }
    try {
      await engine.dispose();
    } catch (e) {
      debugPrint('MIC: recorder dispose failed: $e');
    }
  }

  Future<void> openSystemSettings() => openAppSettings();

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _state = MicFeatureState.disposed;
    onResult = null;
    unawaited(_teardown());
    super.dispose();
  }
}
