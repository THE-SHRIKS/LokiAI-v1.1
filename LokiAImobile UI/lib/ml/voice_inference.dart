import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/services.dart' show rootBundle;
import 'package:record/record.dart';
import 'package:tflite_flutter/tflite_flutter.dart';

/// TFLite audio classification on live microphone input.
///
/// Model-generic: input/output tensor shapes are introspected at load time.
/// Class names come from the bundled AudioSet label map when the model's
/// class count matches (YAMNet-style, 521 classes); any other class count
/// falls back to numeric class ids. Real inference output only.
class VoiceInference {
  final AudioRecorder _audioRecorder = AudioRecorder();
  Interpreter? _interpreter;
  String? _loadError;
  bool _isRecording = false;
  Map<int, String> _labels = const {};
  StreamSubscription? _audioSubscription;

  Future<void> initialize(String modelPath) async {
    try {
      _interpreter = await Interpreter.fromFile(File(modelPath));
      _interpreter!.allocateTensors();
      // ignore: avoid_print
      print('VOICE: model loaded: $modelPath '
          'in=${_interpreter!.getInputTensor(0).shape} '
          'out=${_interpreter!.getOutputTensor(0).shape}');
    } catch (e) {
      _loadError = 'This audio model could not load: $e. '
          'Try a different one from the dashboard.';
      // ignore: avoid_print
      print('VOICE: failed to load audio model: $e');
      return;
    }

    try {
      final raw = await rootBundle.loadString('assets/audioset_labels.txt');
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      _labels = decoded.map((k, v) => MapEntry(int.parse(k), v.toString()));
      // ignore: avoid_print
      print('VOICE: ${_labels.length} AudioSet labels loaded');
    } catch (e) {
      // ignore: avoid_print
      print('VOICE: labels unavailable ($e) — numeric class ids will be used');
      _labels = const {};
    }
  }

  Future<void> startListening(Function(String) onResult) async {
    if (_interpreter == null) {
      onResult(_loadError ?? 'Audio model is not loaded yet.');
      return;
    }
    if (!await _audioRecorder.hasPermission()) {
      onResult('Permission denied for microphone');
      return;
    }
    if (_isRecording) return;
    _isRecording = true;

    try {
      final stream = await _audioRecorder.startStream(const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: 16000,
        numChannels: 1,
      ));

      // Samples needed by the model (e.g. YAMNet: 15600 = 0.975s @ 16kHz).
      final wanted = _interpreter!
          .getInputTensor(0)
          .shape
          .reduce((a, b) => a * b);
      final bytesNeeded = wanted * 2; // PCM16 = 2 bytes/sample
      final audioBuffer = <int>[];

      _audioSubscription = stream.listen((data) {
        if (!_isRecording) return;
        audioBuffer.addAll(data);
        if (audioBuffer.length >= bytesNeeded) {
          final chunk = audioBuffer.sublist(0, bytesNeeded);
          audioBuffer.removeRange(0, bytesNeeded);
          _runInference(chunk, onResult);
        }
      }, onError: (Object e) {
        onResult('Microphone stream error: $e');
      });
    } catch (e) {
      _isRecording = false;
      onResult('Could not start recording: $e');
    }
  }

  void _runInference(List<int> pcmBytes, Function(String) onResult) {
    final interp = _interpreter;
    if (interp == null) return;
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

      // Flatten scores regardless of output rank.
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

      String nameOf(int i) =>
          (_labels.length == scores.length) ? (_labels[i] ?? 'class $i') : 'class $i';

      final text = top
          .map((i) => '${nameOf(i)} ${(scores[i] * 100).toStringAsFixed(0)}%')
          .join(' · ');
      // ignore: avoid_print
      print('VOICE: result -> $text');
      onResult(text);
    } catch (e) {
      // ignore: avoid_print
      print('VOICE: inference error: $e');
      onResult('Voice inference error: $e');
    }
  }

  Future<void> stopListening() async {
    _isRecording = false;
    await _audioSubscription?.cancel();
    _audioSubscription = null;
    try {
      await _audioRecorder.stop();
    } catch (_) {}
  }

  void dispose() {
    _audioSubscription?.cancel();
    _audioRecorder.dispose();
    _interpreter?.close();
  }
}
