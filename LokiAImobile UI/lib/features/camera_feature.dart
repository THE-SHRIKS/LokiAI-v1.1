import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

import '../diagnostics.dart';
import '../ml/vision_engine.dart';

/// Every state the camera feature can be in. Section 5 of the repair plan
/// fixes this list; the UI renders from it and nothing else.
enum CameraFeatureState {
  idle,
  requestingPermission,
  permissionDenied,
  permissionPermanentlyDenied,
  initializing,
  ready,
  capturing,
  processing,
  failed,
  disposed,
}

/// Owns the camera lifecycle end to end: permission, controller creation,
/// preview, capture, validation, recognition, and disposal.
///
/// Previously this logic was spread between `_LokiHomeScreenState._toggleCamera`
/// and `CameraInference`, where the preview was only started from inside the
/// TFLite isolate's ready callback. A model that failed to load therefore meant
/// no preview at all, and toggling the camera off disposed `ValueNotifier`s that
/// a `ValueListenableBuilder` was still subscribed to — a
/// "used after being disposed" `FlutterError` on the very next frame.
class CameraFeatureController extends ChangeNotifier {
  CameraFeatureController();

  CameraFeatureState _state = CameraFeatureState.idle;
  CameraController? _controller;
  VisionEngine? _engine;

  String _statusMessage = '';
  String? _lastResult;
  String? _correlationId;
  bool _fireDetected = false;

  /// Guards against rapid repeated taps creating parallel controllers.
  bool _openInFlight = false;
  bool _captureInFlight = false;
  bool _disposed = false;

  /// Remembered so a background/foreground cycle can rebuild the camera with
  /// the same model without re-prompting for permission.
  String? _modelPath;
  bool _wasReadyBeforeBackground = false;

  /// Confidence at or above which the live preview shows the alert border.
  double confidenceThreshold = 0.65;

  static const Duration _initTimeout = Duration(seconds: 15);
  static const int _maxCaptureBytes = 20 * 1024 * 1024;
  static const Set<String> _supportedCaptureExtensions = {
    '.jpg',
    '.jpeg',
    '.png',
    '.heic',
    '.heif',
  };

  CameraFeatureState get state => _state;
  String get statusMessage => _statusMessage;
  String? get lastResult => _lastResult;
  String? get correlationId => _correlationId;
  bool get fireDetected => _fireDetected;
  CameraController? get previewController =>
      _controller?.value.isInitialized == true ? _controller : null;

  /// True while the camera surface should be shown at all.
  bool get isOpen =>
      _state != CameraFeatureState.idle && _state != CameraFeatureState.disposed;

  /// Recognition is optional: the preview works without a vision model.
  bool get recognitionAvailable => _engine?.isReady == true;

  bool get canCapture =>
      _state == CameraFeatureState.ready && !_captureInFlight;

  void _set(CameraFeatureState state, {String? message}) {
    if (_disposed) return;
    _state = state;
    if (message != null) _statusMessage = message;
    notifyListeners();
  }

  /// Opens the camera. Safe to call repeatedly — concurrent calls collapse into
  /// the first one.
  ///
  /// [modelPath] is the deployed TFLite vision model, or null when none is
  /// deployed. A null or failing model disables recognition but still opens the
  /// preview.
  Future<void> open({String? modelPath}) async {
    if (_disposed || _openInFlight) return;
    if (_state == CameraFeatureState.ready ||
        _state == CameraFeatureState.initializing) {
      return;
    }
    _openInFlight = true;
    _modelPath = modelPath;
    _correlationId = Diagnostics.newCorrelationId();
    try {
      await _openNow(modelPath);
    } catch (error, stackTrace) {
      Diagnostics.capture(
        feature: 'camera.open',
        error: error,
        stackTrace: stackTrace,
        correlationId: _correlationId,
      );
      await _teardownController();
      _set(
        CameraFeatureState.failed,
        message: 'The camera could not be opened. $error',
      );
    } finally {
      _openInFlight = false;
    }
  }

  Future<void> _openNow(String? modelPath) async {
    _lastResult = null;
    _fireDetected = false;

    // 1. Capability check before asking for anything.
    List<CameraDescription> cameras;
    _set(
      CameraFeatureState.initializing,
      message: 'Checking for a camera…',
    );
    try {
      cameras = await availableCameras();
    } catch (e) {
      // Not just CameraException: a release build with a plugin-registration
      // problem raises MissingPluginException here, which was previously
      // unhandled and therefore fatal.
      Diagnostics.capture(
        feature: 'camera.enumerate',
        error: e,
        correlationId: _correlationId,
      );
      _set(
        CameraFeatureState.failed,
        message: 'This device did not report a usable camera '
            '(${e is CameraException ? e.code : e.runtimeType}).',
      );
      return;
    }
    if (cameras.isEmpty) {
      _set(
        CameraFeatureState.failed,
        message: 'This device has no camera available.',
      );
      return;
    }

    // 2. Permission, requested only now that the user invoked the feature.
    _set(
      CameraFeatureState.requestingPermission,
      message: 'Waiting for camera permission…',
    );
    final status = await Permission.camera.request();
    if (_disposed) return;
    if (status.isPermanentlyDenied) {
      _set(
        CameraFeatureState.permissionPermanentlyDenied,
        message:
            'Camera access is blocked for LokiAI. Open Settings to allow it.',
      );
      return;
    }
    if (!status.isGranted) {
      _set(
        CameraFeatureState.permissionDenied,
        message: 'Camera permission was denied. Chat still works.',
      );
      return;
    }

    // 3. Controller — created only after the grant.
    _set(CameraFeatureState.initializing, message: 'Starting the camera…');
    final description = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.back,
      orElse: () => cameras.first,
    );
    final controller = CameraController(
      description,
      ResolutionPreset.medium,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.yuv420,
    );
    _controller = controller;

    try {
      await controller.initialize().timeout(_initTimeout);
    } on TimeoutException {
      await _teardownController();
      _set(
        CameraFeatureState.failed,
        message:
            'The camera did not start within ${_initTimeout.inSeconds}s. '
            'Close any other app using it and try again.',
      );
      return;
    } on CameraException catch (e) {
      await _teardownController();
      Diagnostics.capture(
        feature: 'camera.initialize',
        error: e,
        correlationId: _correlationId,
      );
      final busy = e.code == 'CameraAccessDenied' ||
          e.code.contains('InUse') ||
          e.code == 'cameraPermission';
      _set(
        CameraFeatureState.failed,
        message: busy
            ? 'The camera is in use by another app. Close it and try again.'
            : 'The camera could not start (${e.code}).',
      );
      return;
    }

    // The controller may have been disposed while initialize() was in flight.
    if (_disposed || !identical(_controller, controller)) {
      await controller.dispose();
      return;
    }

    _set(
      CameraFeatureState.ready,
      message: modelPath == null
          ? 'Camera ready. Deploy a vision model to label what it sees.'
          : 'Camera ready.',
    );

    // 4. Recognition is started separately and is allowed to fail.
    if (modelPath != null) {
      await _startRecognition(modelPath, controller);
    }
  }

  Future<void> _startRecognition(
    String modelPath,
    CameraController controller,
  ) async {
    final engine = VisionEngine();
    _engine = engine;
    engine.setStreamListener((label, confidence) {
      if (_disposed || !identical(_engine, engine)) return;
      _lastResult = label;
      _fireDetected = confidence >= confidenceThreshold;
      if (!_disposed) notifyListeners();
    });
    await engine.start(modelPath);
    try {
      await engine.ready;
    } catch (error) {
      Diagnostics.capture(
        feature: 'camera.vision_engine',
        error: error,
        correlationId: _correlationId,
      );
      if (identical(_engine, engine)) {
        _engine = null;
        _statusMessage =
            'Camera is live, but the deployed vision model could not load: '
            '$error';
        if (!_disposed) notifyListeners();
      }
      await engine.dispose();
      return;
    }
    if (_disposed || !identical(_engine, engine)) {
      await engine.dispose();
      return;
    }
    // Live labelling. Stream errors are captured, never thrown at the platform.
    try {
      if (!controller.value.isStreamingImages) {
        await controller.startImageStream((image) {
          if (_disposed || !identical(_engine, engine)) return;
          engine.offerFrame(image);
        });
      }
    } catch (error, stackTrace) {
      Diagnostics.capture(
        feature: 'camera.image_stream',
        error: error,
        stackTrace: stackTrace,
        correlationId: _correlationId,
      );
    }
  }

  /// Captures a still, validates it, and runs it through the recognition
  /// pipeline. Repeated taps while a capture is in flight are ignored.
  Future<void> capture() async {
    if (_disposed || _captureInFlight) return;
    if (_state != CameraFeatureState.ready) return;
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;

    _captureInFlight = true;
    final correlationId = Diagnostics.newCorrelationId();
    _correlationId = correlationId;
    _set(CameraFeatureState.capturing, message: 'Capturing…');

    XFile? shot;
    try {
      // takePicture() fails on some devices while an image stream is running.
      final wasStreaming = controller.value.isStreamingImages;
      if (wasStreaming) {
        await controller.stopImageStream();
      }
      shot = await controller.takePicture();
      if (_disposed) return;

      final validation = await _validateCapture(shot);
      if (validation != null) {
        _set(CameraFeatureState.failed, message: validation);
        return;
      }

      final engine = _engine;
      if (engine == null || !engine.isReady) {
        _lastResult = null;
        _set(
          CameraFeatureState.ready,
          message:
              'Photo captured, but no vision model is deployed to read it. '
              'Deploy one from the dashboard.',
        );
        return;
      }

      _set(CameraFeatureState.processing, message: 'Recognizing…');
      final bytes = await File(shot.path).readAsBytes();
      final result = await engine.recognizeStill(bytes);
      if (_disposed) return;
      _lastResult = result;
      _set(CameraFeatureState.ready, message: result);
    } catch (error, stackTrace) {
      final record = Diagnostics.capture(
        feature: 'camera.capture',
        error: error,
        stackTrace: stackTrace,
        correlationId: correlationId,
      );
      if (!_disposed) {
        _set(
          CameraFeatureState.failed,
          message: 'Capture failed. Reference ${record.correlationId}.',
        );
      }
    } finally {
      _captureInFlight = false;
      // Restore the live stream so the preview keeps labelling.
      final engine = _engine;
      if (!_disposed &&
          engine != null &&
          engine.isReady &&
          controller.value.isInitialized &&
          !controller.value.isStreamingImages) {
        try {
          await controller.startImageStream((image) {
            if (_disposed || !identical(_engine, engine)) return;
            engine.offerFrame(image);
          });
        } catch (error, stackTrace) {
          Diagnostics.capture(
            feature: 'camera.image_stream_restart',
            error: error,
            stackTrace: stackTrace,
            correlationId: correlationId,
          );
        }
      }
      // Captures are working files, not user library content — remove them
      // once recognition is done rather than accumulating them on disk.
      if (shot != null) {
        unawaited(
          File(shot.path).delete().catchError((Object _) => File(shot!.path)),
        );
      }
    }
  }

  /// Returns null when the captured file is usable, or a user-readable reason.
  Future<String?> _validateCapture(XFile shot) async {
    final file = File(shot.path);
    if (!await file.exists()) {
      return 'The captured photo was not written to storage.';
    }
    final extension = shot.path.contains('.')
        ? shot.path.substring(shot.path.lastIndexOf('.')).toLowerCase()
        : '';
    if (!_supportedCaptureExtensions.contains(extension)) {
      return 'The camera produced an unsupported image format ($extension).';
    }
    int length;
    try {
      length = await file.length();
    } catch (e) {
      return 'The captured photo could not be read ($e).';
    }
    if (length <= 0) return 'The captured photo was empty.';
    if (length > _maxCaptureBytes) {
      return 'The captured photo is larger than '
          '${_maxCaptureBytes ~/ (1024 * 1024)} MB and was not processed.';
    }
    return null;
  }

  /// Closes the camera and returns to idle without destroying the controller
  /// object graph the widget tree may still be building against.
  Future<void> close() async {
    if (_disposed) return;
    await _teardownController();
    _lastResult = null;
    _fireDetected = false;
    _set(CameraFeatureState.idle, message: '');
  }

  /// Android reclaims the camera when the app is backgrounded. Releasing it
  /// explicitly (and rebuilding on resume) avoids the "camera already in use"
  /// failure that otherwise persists until a force-restart.
  Future<void> handleAppPaused() async {
    if (_disposed) return;
    _wasReadyBeforeBackground = _state == CameraFeatureState.ready;
    if (!isOpen) return;
    await _teardownController();
    if (_wasReadyBeforeBackground) {
      _set(CameraFeatureState.initializing, message: 'Camera paused.');
    }
  }

  Future<void> handleAppResumed() async {
    if (_disposed || !_wasReadyBeforeBackground) return;
    _wasReadyBeforeBackground = false;
    await open(modelPath: _modelPath);
  }

  /// Stops the stream, disposes the controller and the engine. Idempotent —
  /// each underlying object is disposed exactly once because the fields are
  /// cleared before the awaits.
  Future<void> _teardownController() async {
    final controller = _controller;
    final engine = _engine;
    _controller = null;
    _engine = null;

    if (controller != null) {
      try {
        if (controller.value.isStreamingImages) {
          await controller.stopImageStream();
        }
      } catch (e) {
        debugPrint('CAMERA: stopping image stream failed: $e');
      }
      try {
        await controller.dispose();
      } catch (e) {
        debugPrint('CAMERA: controller dispose failed: $e');
      }
    }
    if (engine != null) {
      try {
        await engine.dispose();
      } catch (e) {
        debugPrint('CAMERA: vision engine dispose failed: $e');
      }
    }
  }

  Future<void> openSystemSettings() => openAppSettings();

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _state = CameraFeatureState.disposed;
    // Fire and forget: ChangeNotifier.dispose is synchronous, and the fields
    // are already detached so nothing can be disposed twice.
    unawaited(_teardownController());
    super.dispose();
  }
}
