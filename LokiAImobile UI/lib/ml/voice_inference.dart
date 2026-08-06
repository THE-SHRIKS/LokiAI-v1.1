import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:record/record.dart';
import 'package:tflite_flutter/tflite_flutter.dart';

import 'model_guard.dart';

/// TFLite audio classification on live microphone input.
///
/// Model-generic: input/output tensor shapes are introspected at load time.
/// Class names come from the bundled AudioSet label map when the model's class
/// count matches (YAMNet-style, 521 classes); any other class count falls back
/// to numeric class ids. Real inference output only.
///
/// Every entry point returns a user-readable error string instead of throwing
/// or silently swallowing, so `MicFeatureController` can always reach a
/// terminal state. Permission is NOT requested here — the controller owns it.
class VoiceInference {
  AudioRecorder? _audioRecorder;
  Interpreter? _interpreter;
  bool _isRecording = false;
  bool _disposed = false;
  Map<int, String> _labels = const {};
  StreamSubscription<List<int>>? _audioSubscription;

  AudioRecorder get _recorder => _audioRecorder ??= AudioRecorder();

  // The exact contract the current supported adapter (tflite_yamnet_audio_v1)
  // requires. YAMNet takes 0.975s of mono 16kHz PCM (15600 samples) and
  // produces 521 AudioSet class scores. Any artifact that does not match
  // this is rejected — before deployment AND at mic runtime, through this
  // one shared gate — rather than accepted on a loose "float32 + positive
  // shape" heuristic that the real streaming pipeline could not actually
  // honor. See AudioAdapterContract for the single source of truth.
  static const int yamnetSampleRate = 16000;
  static const int yamnetInputSamples = 15600;
  static const int yamnetOutputClasses = 521;

  /// Loads [modelPath]. Returns null on success, or a user-readable reason.
  /// Delegates the entire compatibility+probe decision to
  /// [validateAndProbe] so the microphone runtime and the deployment smoke
  /// test can never disagree about whether a model is usable.
  Future<String?> loadModel(String modelPath) async {
    if (_disposed) return 'The microphone was closed before the model loaded.';
    final probe = await validateAndProbe(modelPath);
    if (probe.rejection != null) {
      debugPrint('VOICE: refusing audio model: ${probe.rejection}');
      return probe.rejection!.message;
    }
    _interpreter = probe.interpreter;
    _labels = probe.labels;
    debugPrint(
      'VOICE: model loaded: $modelPath '
      'in=${_interpreter!.getInputTensor(0).shape} '
      'out=${_interpreter!.getOutputTensor(0).shape} '
      'labels=${_labels.length}',
    );
    return null;
  }

  /// The single authoritative audio-adapter check: structural validation,
  /// exact tensor-contract validation (count/dtype/shape), label-contract
  /// validation, and a real inference through the exact production
  /// preprocessing/postprocessing path on a synthetic waveform.
  ///
  /// Used both by [loadModel] (real microphone runtime) and by the
  /// deployment smoke test in model_downloader.dart, so "ready" can never
  /// mean something different to the two callers. On success the returned
  /// [_AudioProbeResult.interpreter] is the same live interpreter the caller
  /// should keep (loadModel) or must close (the smoke test) — ownership
  /// transfers to the caller either way; this method never closes it on the
  /// success path.
  static Future<_AudioProbeResult> validateAndProbe(String modelPath) async {
    final structural = await ModelGuard.validateAudioTflite(modelPath);
    if (structural != null) {
      return _AudioProbeResult(rejection: structural);
    }

    Interpreter? interpreter;
    try {
      interpreter = Interpreter.fromFile(File(modelPath));
      interpreter.allocateTensors();
    } catch (e) {
      try {
        interpreter?.close();
      } catch (_) {}
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_INTERPRETER_INIT_FAILED',
          'This audio model could not be opened by the TFLite interpreter '
              'on this device ($e).',
        ),
      );
    }

    final inputs = interpreter.getInputTensors();
    final outputs = interpreter.getOutputTensors();
    if (inputs.length != 1 || outputs.isEmpty) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_BUNDLE_INCOMPLETE',
          'This audio model declares ${inputs.length} input tensor(s) and '
              '${outputs.length} output tensor(s). LokiAI\'s microphone '
              'pipeline requires exactly one input tensor and at least one '
              'output tensor.',
        ),
      );
    }
    final inTensor = inputs.first;
    final outTensor = outputs.first;
    if (inTensor.type != TensorType.float32 ||
        outTensor.type != TensorType.float32) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_INPUT_DTYPE_MISMATCH',
          'This audio model uses ${inTensor.type}/${outTensor.type} '
              'tensors. LokiAI\'s microphone pipeline only supports a '
              'standard float32 sound-classification TFLite model.',
        ),
      );
    }
    if (inTensor.shape.any((d) => d <= 0) || outTensor.shape.any((d) => d <= 0)) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_INPUT_SHAPE_MISMATCH',
          'This audio model has a dynamic or invalid tensor shape '
              '(in=${inTensor.shape}, out=${outTensor.shape}). LokiAI '
              'requires a fixed-shape model.',
        ),
      );
    }

    // Known-family signature check: the only adapter currently implemented
    // is YAMNet-shaped (15600 mono float32 samples @ 16kHz -> 521 AudioSet
    // classes). A model that is float32 and well-formed but a different
    // architecture (different window length or class count) would still
    // silently mis-classify at runtime, so it is rejected here rather than
    // accepted on dtype alone.
    final inputSamples = inTensor.shape.reduce((a, b) => a * b);
    if (inputSamples != yamnetInputSamples) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_SAMPLE_RATE_UNSUPPORTED',
          'This audio model expects an input window of $inputSamples '
              'samples. LokiAI\'s only implemented audio adapter '
              '(tflite_yamnet_audio_v1) requires exactly $yamnetInputSamples '
              'samples (0.975s @ ${yamnetSampleRate}Hz mono).',
        ),
      );
    }
    final outputClasses = outTensor.shape.reduce((a, b) => a * b);

    Map<int, String> labels = const {};
    try {
      final raw = await rootBundle.loadString('assets/audioset_labels.txt');
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      labels = decoded.map((k, v) => MapEntry(int.parse(k), v.toString()));
    } catch (e) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_LABEL_CONTRACT_MISMATCH',
          'The bundled AudioSet label map could not be loaded ($e), so '
              'model output cannot be mapped to a label.',
        ),
      );
    }
    if (labels.isEmpty) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: const ModelRejection(
          'AUDIO_LABEL_CONTRACT_MISMATCH',
          'No labels are available to map this audio model\'s output to.',
        ),
      );
    }
    if (outputClasses != labels.length || outputClasses != yamnetOutputClasses) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_LABEL_CONTRACT_MISMATCH',
          'This audio model outputs $outputClasses classes but the bundled '
              'label set has ${labels.length} entries (adapter '
              'tflite_yamnet_audio_v1 requires exactly $yamnetOutputClasses).',
        ),
      );
    }

    // Real inference through the exact production preprocessing and
    // postprocessing path (see _decodeAndRun below), on a synthetic 1kHz
    // tone rather than a zero tensor — proves the full pipeline, not just
    // that the interpreter can be invoked.
    try {
      final synthetic = _syntheticPcm16(yamnetInputSamples);
      final scores = _decodeAndRun(interpreter, inTensor.shape, outTensor.shape, synthetic);
      if (scores.isEmpty || scores.length != labels.length) {
        interpreter.close();
        return _AudioProbeResult(
          rejection: ModelRejection(
            'AUDIO_SMOKE_TEST_FAILED',
            'This audio model produced ${scores.length} output values on a '
                'bounded smoke inference; expected ${labels.length}.',
          ),
        );
      }
    } catch (e) {
      interpreter.close();
      return _AudioProbeResult(
        rejection: ModelRejection(
          'AUDIO_SMOKE_TEST_FAILED',
          'This audio model failed a bounded smoke inference through the '
              'real microphone preprocessing/inference/output-parsing path '
              'on this device ($e).',
        ),
      );
    }

    return _AudioProbeResult(interpreter: interpreter, labels: labels);
  }

  /// A synthetic 1kHz sine tone encoded as PCM16 little-endian bytes, the
  /// exact wire format the live recorder stream delivers.
  static List<int> _syntheticPcm16(int samples) {
    final bytes = <int>[];
    for (var i = 0; i < samples; i++) {
      final t = i / yamnetSampleRate;
      final value = (math.sin(2 * math.pi * 1000 * t) * 16000).round();
      final clamped = value.clamp(-32768, 32767);
      final unsigned = clamped < 0 ? clamped + 65536 : clamped;
      bytes.add(unsigned & 0xff);
      bytes.add((unsigned >> 8) & 0xff);
    }
    return bytes;
  }

  /// Whether the platform reports a usable input device. `record` surfaces this
  /// through hasPermission()/available encoders; a throw here means no
  /// microphone rather than a denied permission (which the controller checks
  /// before ever calling this).
  Future<bool> hasMicrophone() async {
    if (_disposed) return false;
    try {
      return await _recorder.isEncoderSupported(AudioEncoder.pcm16bits);
    } catch (e) {
      debugPrint('VOICE: microphone capability check failed: $e');
      return false;
    }
  }

  /// Starts streaming and inference. Returns null on success, or a
  /// user-readable reason. Never throws.
  Future<String?> startListening(void Function(String) onResult) async {
    if (_disposed) return 'The microphone was already closed.';
    final interpreter = _interpreter;
    if (interpreter == null) return 'The audio model is not loaded.';
    // A second session on the same recorder is what produced overlapping
    // streams on rapid taps.
    if (_isRecording) return null;

    try {
      final stream = await _recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: 16000,
          numChannels: 1,
        ),
      );
      _isRecording = true;

      // Samples needed by the model (e.g. YAMNet: 15600 = 0.975s @ 16kHz).
      final wanted = interpreter
          .getInputTensor(0)
          .shape
          .reduce((a, b) => a * b);
      final bytesNeeded = wanted * 2; // PCM16 = 2 bytes/sample
      final audioBuffer = <int>[];

      _audioSubscription = stream.listen(
        (data) {
          if (!_isRecording || _disposed) return;
          audioBuffer.addAll(data);
          while (audioBuffer.length >= bytesNeeded) {
            final chunk = audioBuffer.sublist(0, bytesNeeded);
            audioBuffer.removeRange(0, bytesNeeded);
            _runInference(chunk, onResult);
          }
        },
        onError: (Object e) {
          debugPrint('VOICE: stream error: $e');
          if (!_disposed) onResult('Microphone stream error: $e');
        },
        cancelOnError: false,
      );
      return null;
    } catch (e) {
      _isRecording = false;
      debugPrint('VOICE: could not start recording: $e');
      return 'Could not start recording: $e';
    }
  }

  void _runInference(List<int> pcmBytes, void Function(String) onResult) {
    final interp = _interpreter;
    if (interp == null || _disposed) return;
    try {
      final inShape = interp.getInputTensor(0).shape;
      final outShape = interp.getOutputTensor(0).shape;
      final scores = _decodeAndRun(interp, inShape, outShape, pcmBytes);
      if (scores.isEmpty) {
        onResult('Model produced no output');
        return;
      }

      final indexed = List.generate(scores.length, (i) => i);
      indexed.sort((a, b) => scores[b].compareTo(scores[a]));
      final top = indexed.take(3).toList();

      String nameOf(int i) => (_labels.length == scores.length)
          ? (_labels[i] ?? 'class $i')
          : 'class $i';

      final text = top
          .map((i) => '${nameOf(i)} ${(scores[i] * 100).toStringAsFixed(0)}%')
          .join(' · ');
      debugPrint('VOICE: result -> $text');
      onResult(text);
    } catch (e) {
      debugPrint('VOICE: inference error: $e');
      onResult('Voice inference error: $e');
    }
  }

  /// The exact production decode/run/flatten path: PCM16 little-endian bytes
  /// -> float32 [-1, 1] -> reshape to the model's declared input shape ->
  /// interpreter.run() -> flattened output scores. Shared by real streaming
  /// inference ([_runInference]) and the deployment/mic-load smoke test
  /// ([validateAndProbe]) so both exercise byte-for-byte the same pipeline.
  static List<double> _decodeAndRun(
    Interpreter interp,
    List<int> inShape,
    List<int> outShape,
    List<int> pcmBytes,
  ) {
    final wanted = inShape.reduce((a, b) => a * b);
    final floats = List<double>.filled(wanted, 0.0);
    final n = math.min(wanted, pcmBytes.length ~/ 2);
    for (int i = 0; i < n; i++) {
      int sample = pcmBytes[i * 2] | (pcmBytes[i * 2 + 1] << 8);
      if (sample >= 32768) sample -= 65536;
      floats[i] = sample / 32768.0;
    }

    final input = floats.reshape(inShape);
    final outSize = outShape.reduce((a, b) => a * b);
    final output = List<double>.filled(outSize, 0.0).reshape(outShape);

    interp.run(input, output);

    final scores = <double>[];
    void flatten(dynamic v) {
      if (v is num) {
        scores.add(v.toDouble());
      } else if (v is List) {
        v.forEach(flatten);
      }
    }

    flatten(output);
    return scores;
  }

  Future<void> stopListening() async {
    _isRecording = false;
    final subscription = _audioSubscription;
    _audioSubscription = null;
    try {
      await subscription?.cancel();
    } catch (e) {
      debugPrint('VOICE: cancelling audio stream failed: $e');
    }
    final recorder = _audioRecorder;
    if (recorder == null) return;
    try {
      if (await recorder.isRecording()) {
        await recorder.stop();
      }
    } catch (e) {
      debugPrint('VOICE: stopping recorder failed: $e');
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    // Active recording must be stopped before the recorder is torn down.
    await stopListening();
    final recorder = _audioRecorder;
    _audioRecorder = null;
    if (recorder != null) {
      try {
        await recorder.dispose();
      } catch (e) {
        debugPrint('VOICE: recorder dispose failed: $e');
      }
    }
    try {
      _interpreter?.close();
    } catch (e) {
      debugPrint('VOICE: interpreter close failed: $e');
    }
    _interpreter = null;
  }
}

/// Result of [VoiceInference.validateAndProbe]: either a live, already-run
/// [interpreter] (caller takes ownership and must eventually close it) plus
/// the resolved [labels], or a [rejection] explaining precisely why the
/// artifact does not satisfy the production audio-adapter contract.
class _AudioProbeResult {
  final Interpreter? interpreter;
  final Map<int, String> labels;
  final ModelRejection? rejection;

  const _AudioProbeResult({
    this.interpreter,
    this.labels = const {},
    this.rejection,
  });
}
