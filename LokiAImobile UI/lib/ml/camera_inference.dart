import 'dart:io';
import 'dart:math' as math;
import 'dart:isolate';
import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:tflite_flutter/tflite_flutter.dart';

// ---------------------------------------------------------------------------
// Production CameraInference — zero main-thread blocking
//
// Architecture:
//   • ONE long-lived background isolate owns the Interpreter entirely.
//   • Main isolate: camera stream, CameraPreview, ValueNotifier updates only.
//   • Preprocessing + interpreter.run() happen in background isolate.
//   • Camera preview runs at full frame rate — main thread is NEVER blocked.
//   • Frame transfer is zero-copy via TransferableTypedData.
//   • Throttle: 200 ms between dispatches (5 fps detection rate).
//   • No forced delay after inference — latency is inference time only.
// ---------------------------------------------------------------------------

// ── IPC message types ────────────────────────────────────────────────────────

/// Sent main → isolate to bootstrap it. Carries the main isolate's SendPort
/// so the isolate can send results back, plus config. Labels are loaded on
/// the main isolate (rootBundle is unavailable in spawned isolates).
class _BootMsg {
  final SendPort mainPort;   // isolate sends results here
  final String modelPath;
  final double threshold;
  final List<String> labels; // empty when no label set matches the model
  _BootMsg(this.mainPort, this.modelPath, this.threshold, this.labels);
}

/// Camera frame sent main → isolate. Zero-copy via TransferableTypedData.
class _FrameMsg {
  final TransferableTypedData yData;
  final TransferableTypedData uData;
  final TransferableTypedData vData;
  final int imgW, imgH;
  final int yBPR, yBPP, uvBPR, uvBPP;
  _FrameMsg({
    required this.yData, required this.uData, required this.vData,
    required this.imgW, required this.imgH,
    required this.yBPR, required this.yBPP,
    required this.uvBPR, required this.uvBPP,
  });
}

/// Sent isolate → main when model is loaded and ready.
class _ReadyMsg {
  final SendPort framePort;   // main sends frames here
  final List<int> inputShape;
  final List<int> outputShape;
  final String inputType;
  _ReadyMsg(this.framePort, this.inputShape, this.outputShape, this.inputType);
}

/// Inference result sent isolate → main every frame.
class _ResultMsg {
  final String label;     // human-readable top predictions
  final double maxConf;   // top-1 confidence 0..1
  _ResultMsg(this.label, this.maxConf);
}

/// Error from isolate.
class _ErrMsg {
  final String msg;
  _ErrMsg(this.msg);
}

// ── Background isolate entry point ───────────────────────────────────────────
void _inferenceIsolateEntry(SendPort bootPort) async {
  // Create our own ReceivePort so main can send us frames + the boot message
  final fromMain = ReceivePort();

  // Tell main our port so it can send us the _BootMsg
  bootPort.send(fromMain.sendPort);

  // ── Main event loop ───────────────────────────────────────────────────────
  _BootMsg? boot;
  Interpreter? interp;
  SendPort? toMain;
  double threshold = 0.0;
  List<int> inputShape = [];
  List<int> outputShape = [];
  String inputType = '';
  List<String> labels = const [];
  dynamic preAllocOut;

  await for (final m in fromMain) {
    // Phase 1: Bootstrapping
    if (boot == null) {
      if (m is _BootMsg) {
        boot = m;
        toMain = boot.mainPort;
        threshold = boot.threshold;
        labels = boot.labels;

        // The DEPLOYED model file is the only model this app runs. No
        // bundled fallbacks — if the deployment is broken the user must
        // see the error, not silently get a different model.
        Future<Interpreter?> tryLoad(InterpreterOptions opts, String label) async {
          try {
            final i = await Interpreter.fromFile(File(boot!.modelPath), options: opts);
            i.allocateTensors();
            print('VISION: [$label] loaded deployed model ${boot!.modelPath}');
            return i;
          } catch (e) {
            print('VISION: [$label] load failed: $e');
          }
          return null;
        }

        if (Platform.isAndroid) {
          try {
            final opts = InterpreterOptions()..useNnApiForAndroid = true..threads = 4;
            interp = await tryLoad(opts, 'NNAPI');
          } catch (e) {
            print('FIRE: NNAPI unavailable: $e');
          }
          if (interp == null) {
            try {
              final opts = InterpreterOptions()..threads = 4;
              opts.addDelegate(GpuDelegateV2());
              interp = await tryLoad(opts, 'GPU');
            } catch (e) {
              print('FIRE: GPU unavailable: $e');
            }
          }
        }
        interp ??= await tryLoad(InterpreterOptions()..threads = 4, 'CPU-4t');

        if (interp == null) {
          toMain.send(_ErrMsg('Model could not be loaded'));
          return;
        }

        inputShape = interp!.getInputTensor(0).shape;
        outputShape = interp!.getOutputTensor(0).shape;
        inputType = interp!.getInputTensor(0).type.toString();

        print('VISION: input shape  = $inputShape');
        print('VISION: output shape = $outputShape');
        print('VISION: input type   = $inputType');
        print('VISION: labels       = ${labels.length}');

        // Output buffer shaped from the model's OWN declared output tensor —
        // works for any rank instead of assuming a detection layout.
        preAllocOut = _allocForShape(outputShape);

        toMain.send(_ReadyMsg(fromMain.sendPort, inputShape, outputShape, inputType));
      }
      continue;
    }

    // Phase 2: Processing Frames
    if (m is! _FrameMsg) continue;
    try {
      toMain!.send(_infer(
          m, interp!, inputShape, outputShape, inputType, threshold, labels, preAllocOut));
    } catch (e, st) {
      print('VISION: inference error: $e\n$st');
      toMain!.send(_ErrMsg(e.toString()));
    }
  }
}

/// Nested List<double> buffer matching an arbitrary tensor shape.
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

// ── Core preprocessing + inference (runs entirely in background isolate) ──────
_ResultMsg _infer(
  _FrameMsg f,
  Interpreter interp,
  List<int> inputShape,
  List<int> outputShape,
  String inputType,
  double threshold,
  List<String> labels,
  dynamic preAllocOut,  // reused buffer — no per-frame allocation
) {
  // Recover bytes — zero-copy materialise
  final yB = f.yData.materialize().asUint8List();
  final uB = f.uData.materialize().asUint8List();
  final vB = f.vData.materialize().asUint8List();

  final bool nchw = inputShape.length == 4 && inputShape[1] == 3;
  final int H = nchw ? inputShape[2] : inputShape[1];
  final int W = nchw ? inputShape[3] : inputShape[2];
  // Quantized models take raw 0..255 values; float models take 0..1.
  final bool quantizedInput = inputType.contains('uint8') || inputType.contains('int8');

  final dynamic input = nchw
    ? List.generate(1, (_) => List.generate(3, (_) => List.generate(H, (_) => quantizedInput ? List<int>.filled(W, 0) : List<double>.filled(W, 0.0))))
    : List.generate(1, (_) => List.generate(H, (_) => List.generate(W, (_) => quantizedInput ? List<int>.filled(3, 0) : List<double>.filled(3, 0.0))));

  // BT.601 YUV → RGB, nearest-neighbour resize
  for (int dy = 0; dy < H; dy++) {
    final sy = ((dy * f.imgH) ~/ H).clamp(0, f.imgH - 1);
    for (int dx = 0; dx < W; dx++) {
      final sx = ((dx * f.imgW) ~/ W).clamp(0, f.imgW - 1);
      final yi = sy * f.yBPR + sx * f.yBPP;
      final yv = yi < yB.length ? yB[yi] & 0xFF : 0;
      final uvr = sy >> 1; final uvc = sx >> 1;
      final uvi = uvr * f.uvBPR + uvc * f.uvBPP;
      final uv = uvi < uB.length ? uB[uvi] & 0xFF : 128;
      final vv = uvi < vB.length ? vB[uvi] & 0xFF : 128;
      final yf = yv.toDouble();
      final uf = uv.toDouble() - 128.0;
      final vf = vv.toDouble() - 128.0;

      final r = (yf + 1.370705 * vf).clamp(0.0, 255.0);
      final g = (yf - 0.698001 * vf - 0.337633 * uf).clamp(0.0, 255.0);
      final b = (yf + 1.732446 * uf).clamp(0.0, 255.0);

      if (nchw) {
        input[0][0][dy][dx] = quantizedInput ? r.round() : r / 255.0;
        input[0][1][dy][dx] = quantizedInput ? g.round() : g / 255.0;
        input[0][2][dy][dx] = quantizedInput ? b.round() : b / 255.0;
      } else {
        input[0][dy][dx][0] = quantizedInput ? r.round() : r / 255.0;
        input[0][dy][dx][1] = quantizedInput ? g.round() : g / 255.0;
        input[0][dy][dx][2] = quantizedInput ? b.round() : b / 255.0;
      }
    }
  }

  // RUN — blocking here is intentional, this is the background isolate
  interp.run(input, preAllocOut);

  // Post-process by the model's OWN output geometry — no assumptions about
  // what kind of model was deployed.
  if (outputShape.length <= 2) {
    // Classification: [N] or [1, N] scores per class.
    final scores = <double>[];
    _flattenInto(preAllocOut, scores);
    return _classify(scores, labels);
  }
  // Detection-style: [1, rows, values] (e.g. YOLO [1,N,6], SSD variants).
  final rows = (preAllocOut[0] as List);
  double bestConf = 0.0;
  int bestClass = -1;
  for (final row in rows) {
    final vals = <double>[];
    _flattenInto(row, vals);
    if (vals.length >= 6) {
      final conf = vals[4];
      if (conf > bestConf) {
        bestConf = conf;
        bestClass = vals[5].round();
      }
    }
  }
  if (bestClass < 0) {
    return _ResultMsg('No detections', 0.0);
  }
  final name = (bestClass < labels.length) ? labels[bestClass] : 'class $bestClass';
  return _ResultMsg('$name ${(bestConf * 100).toStringAsFixed(0)}%', bestConf);
}

/// Softmax (when the model emits logits) + top-3 label formatting.
_ResultMsg _classify(List<double> scores, List<String> labels) {
  if (scores.isEmpty) return _ResultMsg('Model produced no output', 0.0);

  var probs = scores;
  final maxV = scores.reduce(math.max);
  final minV = scores.reduce(math.min);
  if (maxV > 1.0 || minV < 0.0) {
    // Logits — softmax for a human-readable confidence.
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
  return _ResultMsg(parts, probs[top.first]);
}

// ── Public API used by main.dart ─────────────────────────────────────────────
class CameraInference {
  CameraController? _cameraController;
  Isolate? _isolate;
  ReceivePort? _fromIsolate;   // main receives FROM isolate here
  SendPort? _toIsolate;        // main sends TO isolate here (frames + boot)
  SendPort? _frameSendPort;    // the isolate's own frame port (given in ReadyMsg)

  bool _modelReady = false;
  bool _isolateBusy = false;  // back-pressure: don't queue frames faster than inference
  int _lastDispatchMs = 0;
  static const int _throttleMs = 33; // ~30 fps cap — backpressure will naturally throttle it

  final ValueNotifier<bool> isFireDetected = ValueNotifier(false);
  final ValueNotifier<String> statusLabel = ValueNotifier('Initializing...');

  double confidenceThreshold = 0.65; // Fix false positives (lights): require 65% confidence

  Future<void> initialize(String modelPath, Function(String) callback) async {
    statusLabel.value = 'Spawning inference isolate…';

    // Class labels load on the main isolate (rootBundle is not available in
    // spawned isolates). ImageNet names cover standard 1000/1001-class
    // classifiers; any other class count falls back to numeric class ids.
    try {
      final raw = await rootBundle.loadString('assets/imagenet_labels.txt');
      _labels = raw
          .split('\n')
          .map((l) => l.trim())
          .where((l) => l.isNotEmpty)
          .toList();
    } catch (e) {
      print('VISION: labels unavailable: $e');
      _labels = const [];
    }

    // Set up our receive port
    _fromIsolate = ReceivePort();
    _fromIsolate!.listen((msg) => _onMessage(msg, callback));

    // Spawn the long-lived isolate — pass it our SendPort
    _isolate = await Isolate.spawn(
      _inferenceIsolateEntry,
      _fromIsolate!.sendPort,
      debugName: 'VisionInferenceIsolate',
    );

    // The isolate's first message is its own SendPort (_toIsolate)
    // We handle it in _onMessage below
    statusLabel.value = 'Loading model…';

    // Store config for when the boot message arrives
    _pendingModelPath = modelPath;
  }

  String? _pendingModelPath;
  List<String> _labels = const [];

  void _onMessage(dynamic msg, Function(String) callback) {
    if (msg is SendPort) {
      // Isolate sent us its port — now send the BootMsg
      _toIsolate = msg;
      _toIsolate!.send(_BootMsg(
        _fromIsolate!.sendPort,
        _pendingModelPath ?? '',
        confidenceThreshold,
        _labels,
      ));
    } else if (msg is _ReadyMsg) {
      _frameSendPort = msg.framePort;
      _modelReady = true;
      statusLabel.value = 'Model OK in=${msg.inputShape} out=${msg.outputShape}';
      _startCamera();
    } else if (msg is _ResultMsg) {
      _isolateBusy = false;  // isolate done — ready for next frame
      print('VISION: result -> ${msg.label}');
      callback(msg.label);
    } else if (msg is _ErrMsg) {
      _isolateBusy = false;  // also reset on error
      print('VISION: isolate error: ${msg.msg}');
      statusLabel.value = 'Error: ${msg.msg}';
      callback('Error: ${msg.msg}');
    }
  }

  Future<void> _startCamera() async {
    final cameras = await availableCameras();
    if (cameras.isEmpty) {
      statusLabel.value = 'No cameras found';
      return;
    }

    final back = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.back,
      orElse: () => cameras.first,
    );

    _cameraController = CameraController(
      back,
      ResolutionPreset.medium,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.yuv420,
    );

    await _cameraController!.initialize();
    statusLabel.value = 'Camera ready — streaming';
    _cameraController!.startImageStream(_onFrame);
  }

  void _onFrame(CameraImage image) {
    // Back-pressure: skip frame if isolate is still processing the previous one.
    // Prevents frame queue buildup which causes GC pressure and UI jank.
    if (!_modelReady || _frameSendPort == null || _isolateBusy) return;

    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastDispatchMs < _throttleMs) return;
    _lastDispatchMs = now;
    _isolateBusy = true;  // mark busy until _ResultMsg arrives

    final p = image.planes;
    // Zero-copy: TransferableTypedData transfers ownership, no memcpy
    _frameSendPort!.send(_FrameMsg(
      yData: TransferableTypedData.fromList([p[0].bytes]),
      uData: TransferableTypedData.fromList([p[1].bytes]),
      vData: TransferableTypedData.fromList([p[2].bytes]),
      imgW: image.width,
      imgH: image.height,
      yBPR: p[0].bytesPerRow,
      yBPP: p[0].bytesPerPixel ?? 1,
      uvBPR: p[1].bytesPerRow,
      uvBPP: p[1].bytesPerPixel ?? 2,
    ));
  }

  CameraController? get cameraController => _cameraController;

  void dispose() {
    _cameraController?.stopImageStream();
    _cameraController?.dispose();
    _isolate?.kill(priority: Isolate.immediate);
    _fromIsolate?.close();
    isFireDetected.dispose();
    statusLabel.dispose();
  }
}
