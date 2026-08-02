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

  /// Loads [modelPath]. Returns null on success, or a user-readable reason.
  Future<String?> loadModel(String modelPath) async {
    if (_disposed) return 'The microphone was closed before the model loaded.';
    final rejection = await ModelGuard.validateAudioTflite(modelPath);
    if (rejection != null) {
      debugPrint('VOICE: refusing audio model: $rejection');
      return rejection.message;
    }
    Interpreter? interpreter;
    try {
      interpreter = Interpreter.fromFile(File(modelPath));
      interpreter.allocateTensors();
      final inputs = interpreter.getInputTensors();
      final outputs = interpreter.getOutputTensors();
      if (inputs.length != 1 ||
          outputs.isEmpty ||
          inputs.first.type != TensorType.float32 ||
          outputs.first.type != TensorType.float32 ||
          inputs.first.shape.any((dimension) => dimension <= 0) ||
          outputs.first.shape.any((dimension) => dimension <= 0)) {
        interpreter.close();
        return 'This audio model is not compatible with LokiAI microphone input. '
            'Deploy a standard float32 sound-classification TFLite model.';
      }
      _interpreter = interpreter;
      debugPrint(
        'VOICE: model loaded: $modelPath '
        'in=${interpreter.getInputTensor(0).shape} '
        'out=${interpreter.getOutputTensor(0).shape}',
      );
    } catch (e) {
      try {
        interpreter?.close();
      } catch (_) {}
      debugPrint('VOICE: failed to load audio model: $e');
      return 'This audio model could not load on this phone. '
          'Deploy a standard CPU TFLite sound-classification model from the dashboard.';
    }

    try {
      final raw = await rootBundle.loadString('assets/audioset_labels.txt');
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      _labels = decoded.map((k, v) => MapEntry(int.parse(k), v.toString()));
      debugPrint('VOICE: ${_labels.length} AudioSet labels loaded');
    } catch (e) {
      debugPrint('VOICE: labels unavailable ($e) — numeric class ids used');
      _labels = const {};
    }
    return null;
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
      final wanted = inShape.reduce((a, b) => a * b);

      // PCM16 little-endian bytes -> float32 [-1, 1]
      final floats = List<double>.filled(wanted, 0.0);
      final n = math.min(wanted, pcmBytes.length ~/ 2);
      for (int i = 0; i < n; i++) {
        int sample = pcmBytes[i * 2] | (pcmBytes[i * 2 + 1] << 8);
        if (sample >= 32768) sample -= 65536;
        floats[i] = sample / 32768.0;
      }

      final input = floats.reshape(inShape);
      final outShape = interp.getOutputTensor(0).shape;
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
