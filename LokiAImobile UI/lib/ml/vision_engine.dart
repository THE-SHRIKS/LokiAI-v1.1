import 'dart:async';
import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

/// TFLite vision inference, isolated from the camera.
///
/// Previously this file also owned the `CameraController`, which is why a
/// failure to load the deployed model meant the preview never opened at all:
/// `_startCamera()` was only reached from the isolate's `_ReadyMsg`. Camera
/// lifecycle now lives in `CameraFeatureController`; this class is purely an
/// inference engine and every entry point is failure-tolerant.
///
/// Architecture (unchanged and deliberately preserved):
///   ... ONE long-lived background isolate owns the Interpreter entirely.
///   ... Preprocessing + interpreter.run() happen in that isolate.
///   ... Frame transfer is zero-copy via TransferableTypedData.
///   ... Back-pressure: at most one frame in flight.

// -- IPC message types --------------------------------------------------------

class _BootMsg {
  final SendPort mainPort;
  final String modelPath;
  final List<String> labels;
  _BootMsg(this.mainPort, this.modelPath, this.labels);
}

/// YUV420 camera frame, main ?' isolate.
class _FrameMsg {
  final int requestId;
  final TransferableTypedData yData;
  final TransferableTypedData uData;
  final TransferableTypedData vData;
  final int imgW, imgH;
  final int yBPR, yBPP, uvBPR, uvBPP;
  _FrameMsg({
    required this.requestId,
    required this.yData,
    required this.uData,
    required this.vData,
    required this.imgW,
    required this.imgH,
    required this.yBPR,
    required this.yBPP,
    required this.uvBPR,
    required this.uvBPP,
  });
}

/// Decoded still image (packed RGB, 3 bytes per pixel), main ?' isolate.
/// Used by the capture path; the live preview keeps the zero-copy YUV route.
class _StillMsg {
  final int requestId;
  final TransferableTypedData rgb;
  final int width;
  final int height;
  _StillMsg({
    required this.requestId,
    required this.rgb,
    required this.width,
    required this.height,
  });
}

class _ReadyMsg {
  final SendPort framePort;
  final List<int> inputShape;
  final List<int> outputShape;
  final String inputType;
  _ReadyMsg(this.framePort, this.inputShape, this.outputShape, this.inputType);
}

class _ResultMsg {
  final int requestId;
  final String label;
  final double maxConf;
  _ResultMsg(this.requestId, this.label, this.maxConf);
}

class _ErrMsg {
  final int requestId; // -1 = fatal boot error, not tied to a request
  final String msg;
  _ErrMsg(this.requestId, this.msg);
}

// -- Background isolate entry point -------------------------------------------

void _inferenceIsolateEntry(SendPort bootPort) async {
  final fromMain = ReceivePort();
  bootPort.send(fromMain.sendPort);

  _BootMsg? boot;
  Interpreter? interp;
  SendPort? toMain;
  List<int> inputShape = [];
  List<int> outputShape = [];
  String inputType = '';
  List<String> labels = const [];
  dynamic preAllocOut;

  await for (final m in fromMain) {
    if (boot == null) {
      if (m is! _BootMsg) continue;
      boot = m;
      toMain = boot.mainPort;
      labels = boot.labels;

      // The DEPLOYED model file is the only model this app runs. No bundled
      // fallbacks -- a broken deployment must surface as an error, not silently
      // become a different model.
      Interpreter? tryLoad(InterpreterOptions opts, String label) {
        try {
          final i = Interpreter.fromFile(File(boot!.modelPath), options: opts);
          i.allocateTensors();
          debugPrint('VISION: [$label] loaded ${boot.modelPath}');
          return i;
        } catch (e) {
          debugPrint('VISION: [$label] load failed: $e');
          return null;
        }
      }

      if (Platform.isAndroid) {
        try {
          interp = tryLoad(
            InterpreterOptions()
              ..useNnApiForAndroid = true
              ..threads = 4,
            'NNAPI',
          );
        } catch (e) {
          debugPrint('VISION: NNAPI unavailable: $e');
        }
        if (interp == null) {
          try {
            final opts = InterpreterOptions()..threads = 4;
            opts.addDelegate(GpuDelegateV2());
            interp = tryLoad(opts, 'GPU');
          } catch (e) {
            debugPrint('VISION: GPU unavailable: $e');
          }
        }
      }
      interp ??= tryLoad(InterpreterOptions()..threads = 4, 'CPU-4t');

      if (interp == null) {
        toMain.send(_ErrMsg(-1, 'Model could not be loaded'));
        // Stay alive so a dispose() from the main isolate is still orderly;
        // returning here used to leave the ReceivePort dangling.
        boot = null;
        continue;
      }

      inputShape = interp.getInputTensor(0).shape;
      outputShape = interp.getOutputTensor(0).shape;
      inputType = interp.getInputTensor(0).type.toString();
      preAllocOut = _allocForShape(outputShape);

      debugPrint(
        'VISION: in=$inputShape out=$outputShape type=$inputType '
        'labels=${labels.length}',
      );
      toMain.send(
        _ReadyMsg(fromMain.sendPort, inputShape, outputShape, inputType),
      );
      continue;
    }

    if (m is! _FrameMsg && m is! _StillMsg) continue;
    final requestId = m is _FrameMsg ? m.requestId : (m as _StillMsg).requestId;
    try {
      final sampler = m is _FrameMsg ? _yuvSampler(m) : _rgbSampler(m as _StillMsg);
      toMain!.send(
        _infer(
          requestId,
          sampler,
          interp!,
          inputShape,
          outputShape,
          inputType,
          labels,
          preAllocOut,
        ),
      );
    } catch (e, st) {
      debugPrint('VISION: inference error: $e\n$st');
      toMain!.send(_ErrMsg(requestId, e.toString()));
    }
  }
}

/// Nested `List<double>` buffer matching an arbitrary tensor shape.
dynamic _allocForShape(List<int> shape) {
  if (shape.length == 1) return List<double>.filled(shape[0], 0.0);
  return List.generate(shape[0], (_) => _allocForShape(shape.sublist(1)));
}

/// Depth-first flatten of arbitrarily nested numeric lists.
void _flattenInto(dynamic v, List<double> out) {
  if (v is num) {
    out.add(v.toDouble());
  } else if (v is List) {
    for (final e in v) {
      _flattenInto(e, out);
    }
  }
}

/// A source image reduced to "give me the RGB at normalised source pixel
/// (sx, sy)". Lets one preprocessing loop serve both YUV frames and RGB stills.
class _PixelSource {
  final int width;
  final int height;
  final void Function(int sx, int sy, Float32List out) sample;
  _PixelSource(this.width, this.height, this.sample);
}

_PixelSource _yuvSampler(_FrameMsg f) {
  final yB = f.yData.materialize().asUint8List();
  final uB = f.uData.materialize().asUint8List();
  final vB = f.vData.materialize().asUint8List();
  return _PixelSource(f.imgW, f.imgH, (sx, sy, out) {
    final yi = sy * f.yBPR + sx * f.yBPP;
    final yv = yi < yB.length ? yB[yi] & 0xFF : 0;
    final uvi = (sy >> 1) * f.uvBPR + (sx >> 1) * f.uvBPP;
    final uv = uvi < uB.length ? uB[uvi] & 0xFF : 128;
    final vv = uvi < vB.length ? vB[uvi] & 0xFF : 128;
    final yf = yv.toDouble();
    final uf = uv.toDouble() - 128.0;
    final vf = vv.toDouble() - 128.0;
    // BT.601 YUV ?' RGB
    out[0] = (yf + 1.370705 * vf).clamp(0.0, 255.0);
    out[1] = (yf - 0.698001 * vf - 0.337633 * uf).clamp(0.0, 255.0);
    out[2] = (yf + 1.732446 * uf).clamp(0.0, 255.0);
  });
}

_PixelSource _rgbSampler(_StillMsg s) {
  final bytes = s.rgb.materialize().asUint8List();
  return _PixelSource(s.width, s.height, (sx, sy, out) {
    final i = (sy * s.width + sx) * 3;
    if (i + 2 >= bytes.length) {
      out[0] = out[1] = out[2] = 0;
      return;
    }
    out[0] = bytes[i].toDouble();
    out[1] = bytes[i + 1].toDouble();
    out[2] = bytes[i + 2].toDouble();
  });
}

_ResultMsg _infer(
  int requestId,
  _PixelSource src,
  Interpreter interp,
  List<int> inputShape,
  List<int> outputShape,
  String inputType,
  List<String> labels,
  dynamic preAllocOut,
) {
  final bool nchw = inputShape.length == 4 && inputShape[1] == 3;
  final int h = nchw ? inputShape[2] : inputShape[1];
  final int w = nchw ? inputShape[3] : inputShape[2];
  // Quantized models take raw 0..255 values; float models take 0..1.
  final bool quantized =
      inputType.contains('uint8') || inputType.contains('int8');

  final dynamic input = nchw
      ? List.generate(
          1,
          (_) => List.generate(
            3,
            (_) => List.generate(
              h,
              (_) => quantized
                  ? List<int>.filled(w, 0)
                  : List<double>.filled(w, 0.0),
            ),
          ),
        )
      : List.generate(
          1,
          (_) => List.generate(
            h,
            (_) => List.generate(
              w,
              (_) => quantized
                  ? List<int>.filled(3, 0)
                  : List<double>.filled(3, 0.0),
            ),
          ),
        );

  final rgb = Float32List(3);
  for (int dy = 0; dy < h; dy++) {
    final sy = ((dy * src.height) ~/ h).clamp(0, src.height - 1);
    for (int dx = 0; dx < w; dx++) {
      final sx = ((dx * src.width) ~/ w).clamp(0, src.width - 1);
      src.sample(sx, sy, rgb);
      if (nchw) {
        for (int c = 0; c < 3; c++) {
          input[0][c][dy][dx] = quantized ? rgb[c].round() : rgb[c] / 255.0;
        }
      } else {
        for (int c = 0; c < 3; c++) {
          input[0][dy][dx][c] = quantized ? rgb[c].round() : rgb[c] / 255.0;
        }
      }
    }
  }

  interp.run(input, preAllocOut);

  // Post-process by the model's OWN output geometry -- no assumptions about
  // what kind of model was deployed.
  if (outputShape.length <= 2) {
    final scores = <double>[];
    _flattenInto(preAllocOut, scores);
    return _classify(requestId, scores, labels);
  }
  final rows = preAllocOut[0] as List;
  double bestConf = 0.0;
  int bestClass = -1;
  for (final row in rows) {
    final vals = <double>[];
    _flattenInto(row, vals);
    if (vals.length >= 6 && vals[4] > bestConf) {
      bestConf = vals[4];
      bestClass = vals[5].round();
    }
  }
  if (bestClass < 0) return _ResultMsg(requestId, 'No detections', 0.0);
  final name =
      (bestClass >= 0 && bestClass < labels.length)
      ? labels[bestClass]
      : 'class $bestClass';
  return _ResultMsg(
    requestId,
    '$name ${(bestConf * 100).toStringAsFixed(0)}%',
    bestConf,
  );
}

_ResultMsg _classify(int requestId, List<double> scores, List<String> labels) {
  if (scores.isEmpty) {
    return _ResultMsg(requestId, 'Model produced no output', 0.0);
  }

  var probs = scores;
  final maxV = scores.reduce(math.max);
  final minV = scores.reduce(math.min);
  if (maxV > 1.0 || minV < 0.0) {
    // Logits -- softmax for a human-readable confidence.
    final exps = scores.map((s) => math.exp(s - maxV)).toList();
    final sum = exps.reduce((a, b) => a + b);
    probs = exps.map((e) => e / sum).toList();
  }

  final indexed = List.generate(probs.length, (i) => i);
  indexed.sort((a, b) => probs[b].compareTo(probs[a]));
  final top = indexed.take(3).toList();

  String nameOf(int i) {
    if (labels.length == probs.length) return labels[i];
    // TF's canonical ImageNet list has a leading "background" entry; models
    // trained without it output 1000 classes against 1001 labels.
    if (labels.length == probs.length + 1) return labels[i + 1];
    return 'class $i';
  }

  final parts = top
      .map((i) => '${nameOf(i)} ${(probs[i] * 100).toStringAsFixed(0)}%')
      .join(' · ');
  return _ResultMsg(requestId, parts, probs[top.first]);
}

// -- Public API ---------------------------------------------------------------

/// Why the engine is not usable, when it is not.
class VisionEngineException implements Exception {
  final String message;
  VisionEngineException(this.message);
  @override
  String toString() => message;
}

class VisionEngine {
  Isolate? _isolate;
  ReceivePort? _fromIsolate;
  SendPort? _frameSendPort;

  final Completer<void> _ready = Completer<void>();
  bool _disposed = false;
  bool _busy = false;
  int _nextRequestId = 1;
  final Map<int, Completer<String>> _pending = <int, Completer<String>>{};

  /// Live-stream result sink. Null until [setStreamListener] is called.
  void Function(String label, double confidence)? _streamListener;

  /// Resolves when the model is loaded, or completes with a
  /// [VisionEngineException] when it cannot be.
  Future<void> get ready => _ready.future;

  bool get isReady => _ready.isCompleted && !_disposed && _frameSendPort != null;

  static const Duration _loadTimeout = Duration(seconds: 30);
  static const Duration _stillTimeout = Duration(seconds: 20);

  /// Boots the inference isolate for [modelPath].
  ///
  /// Never throws: a load failure completes [ready] with an error instead, so
  /// the camera preview can still open with recognition disabled.
  Future<void> start(String modelPath) async {
    List<String> labels = const [];
    try {
      final raw = await rootBundle.loadString('assets/imagenet_labels.txt');
      labels = raw
          .split('\n')
          .map((l) => l.trim())
          .where((l) => l.isNotEmpty)
          .toList();
    } catch (e) {
      debugPrint('VISION: labels unavailable: $e');
    }

    final port = ReceivePort();
    _fromIsolate = port;
    port.listen(_onMessage);

    try {
      _isolate = await Isolate.spawn(
        _inferenceIsolateEntry,
        port.sendPort,
        debugName: 'VisionInferenceIsolate',
        errorsAreFatal: false,
      );
    } catch (e) {
      _completeReadyError('Could not start the inference isolate: $e');
      return;
    }

    _pendingBoot = _BootPending(modelPath, labels);
    // A native load that never returns must not leave the caller waiting for
    // ever -- the UI has to reach a terminal state.
    Timer(_loadTimeout, () {
      if (!_ready.isCompleted) {
        _completeReadyError(
          'The vision model did not finish loading within '
          '${_loadTimeout.inSeconds}s. It may be too large for this phone.',
        );
      }
    });
  }

  _BootPending? _pendingBoot;

  void _completeReadyError(String message) {
    if (!_ready.isCompleted) {
      _ready.completeError(VisionEngineException(message));
    }
  }

  void _onMessage(dynamic msg) {
    if (_disposed) return;
    if (msg is SendPort) {
      final boot = _pendingBoot;
      if (boot == null) return;
      msg.send(_BootMsg(_fromIsolate!.sendPort, boot.modelPath, boot.labels));
    } else if (msg is _ReadyMsg) {
      _frameSendPort = msg.framePort;
      if (!_ready.isCompleted) _ready.complete();
    } else if (msg is _ResultMsg) {
      _busy = false;
      final pending = _pending.remove(msg.requestId);
      if (pending != null) {
        if (!pending.isCompleted) pending.complete(msg.label);
      } else {
        _streamListener?.call(msg.label, msg.maxConf);
      }
    } else if (msg is _ErrMsg) {
      _busy = false;
      if (msg.requestId == -1) {
        _completeReadyError(
          'This vision model could not be loaded: ${msg.msg}. '
          'Try a different one from the dashboard.',
        );
        return;
      }
      final pending = _pending.remove(msg.requestId);
      if (pending != null && !pending.isCompleted) {
        pending.completeError(VisionEngineException(msg.msg));
      } else {
        _streamListener?.call('Error: ${msg.msg}', 0.0);
      }
    }
  }

  void setStreamListener(void Function(String label, double confidence) fn) {
    _streamListener = fn;
  }

  /// Dispatches a live preview frame. Silently drops the frame when the engine
  /// is not ready or is still processing the previous one (back-pressure).
  void offerFrame(CameraImage image) {
    if (!isReady || _busy) return;
    final planes = image.planes;
    // Some devices/format groups deliver fewer than three planes. Indexing
    // blindly threw a RangeError inside the camera's stream callback, which is
    // an unhandled async error on the platform thread.
    if (planes.length < 3) return;
    _busy = true;
    try {
      _frameSendPort!.send(
        _FrameMsg(
          requestId: 0, // 0 = streaming, result goes to the stream listener
          yData: TransferableTypedData.fromList([planes[0].bytes]),
          uData: TransferableTypedData.fromList([planes[1].bytes]),
          vData: TransferableTypedData.fromList([planes[2].bytes]),
          imgW: image.width,
          imgH: image.height,
          yBPR: planes[0].bytesPerRow,
          yBPP: planes[0].bytesPerPixel ?? 1,
          uvBPR: planes[1].bytesPerRow,
          uvBPP: planes[1].bytesPerPixel ?? 2,
        ),
      );
    } catch (e) {
      _busy = false;
      debugPrint('VISION: frame dispatch failed: $e');
    }
  }

  /// Runs recognition on a captured still image. Decoding happens off the UI
  /// isolate; inference happens in the engine isolate.
  Future<String> recognizeStill(Uint8List encodedImage) async {
    if (!isReady) {
      throw VisionEngineException('The vision model is not loaded.');
    }
    final decoded = await compute(_decodeToRgb, encodedImage);
    if (decoded == null) {
      throw VisionEngineException('The captured image could not be decoded.');
    }
    final id = _nextRequestId++;
    final completer = Completer<String>();
    _pending[id] = completer;
    _frameSendPort!.send(
      _StillMsg(
        requestId: id,
        rgb: TransferableTypedData.fromList([decoded.rgb]),
        width: decoded.width,
        height: decoded.height,
      ),
    );
    return completer.future.timeout(
      _stillTimeout,
      onTimeout: () {
        _pending.remove(id);
        throw VisionEngineException(
          'Recognition timed out after ${_stillTimeout.inSeconds}s.',
        );
      },
    );
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _streamListener = null;
    for (final pending in _pending.values) {
      if (!pending.isCompleted) {
        pending.completeError(VisionEngineException('Engine disposed.'));
      }
    }
    _pending.clear();
    // A never-completed `ready` would strand any awaiting caller.
    _completeReadyError('Engine disposed.');
    _isolate?.kill(priority: Isolate.immediate);
    _isolate = null;
    _fromIsolate?.close();
    _fromIsolate = null;
    _frameSendPort = null;
  }
}

class _BootPending {
  final String modelPath;
  final List<String> labels;
  _BootPending(this.modelPath, this.labels);
}

class _DecodedRgb {
  final Uint8List rgb;
  final int width;
  final int height;
  _DecodedRgb(this.rgb, this.width, this.height);
}

/// Runs on a `compute` isolate -- JPEG decoding of a full-resolution capture is
/// far too slow for the UI isolate.
_DecodedRgb? _decodeToRgb(Uint8List encoded) {
  final decoded = img.decodeImage(encoded);
  if (decoded == null) return null;
  // Cap the working size: a 12 MP still costs ~36 MB as packed RGB and any
  // model input is at most a few hundred pixels square.
  final scaled = (decoded.width > 1024 || decoded.height > 1024)
      ? img.copyResize(
          decoded,
          width: decoded.width >= decoded.height ? 1024 : null,
          height: decoded.height > decoded.width ? 1024 : null,
        )
      : decoded;
  final out = Uint8List(scaled.width * scaled.height * 3);
  var i = 0;
  for (int y = 0; y < scaled.height; y++) {
    for (int x = 0; x < scaled.width; x++) {
      final p = scaled.getPixel(x, y);
      out[i++] = p.r.toInt();
      out[i++] = p.g.toInt();
      out[i++] = p.b.toInt();
    }
  }
  return _DecodedRgb(out, scaled.width, scaled.height);
}
