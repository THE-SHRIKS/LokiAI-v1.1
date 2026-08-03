import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/config_reader.dart';

/// Mirrors `_LokiHomeScreenState._modelPathFor`, which is private to main.dart.
/// The rule it encodes is the one that broke the microphone, so it is worth
/// pinning independently of the widget.
String? modelPathFor(
  String inferenceMode, {
  AppConfig? active,
  List<AppConfig> installed = const [],
}) {
  bool modeMatches(AppConfig model) {
    switch (inferenceMode) {
      case 'camera':
        return model.inferenceMode == 'camera' ||
            model.inferenceMode == 'image-classification' ||
            model.inferenceMode == 'object-detection';
      case 'voice':
        return model.inferenceMode == 'voice' ||
            model.inferenceMode == 'audio' ||
            model.inferenceMode == 'audio-classification' ||
            model.inferenceMode == 'automatic-speech-recognition';
      default:
        return model.inferenceMode == inferenceMode;
    }
  }

  if (active != null &&
      modeMatches(active) &&
      active.modelPath.endsWith('.tflite')) {
    return active.modelPath;
  }
  for (final model in installed.reversed) {
    if (modeMatches(model) && model.modelPath.endsWith('.tflite')) {
      return model.modelPath;
    }
  }
  return null;
}

AppConfig _config(String name, String mode, {String? ext}) => AppConfig(
  modelName: name,
  modelPath:
      '/data/models/$name${ext ?? (mode == 'chat' ? '.gguf' : '.tflite')}',
  inferenceMode: mode,
  format: mode == 'chat' ? 'gguf' : 'tflite',
);

void main() {
  final chat = _config('qwen', 'chat');
  final voice = _config('yamnet', 'voice');
  final audio = _config('audioset', 'audio-classification');
  final vision = _config('mobilenet', 'camera');

  test('the active model is used when it matches the feature', () {
    expect(modelPathFor('voice', active: voice), '/data/models/yamnet.tflite');
  });

  test('a downloaded voice model is found while a chat model is active', () {
    // The regression: config.json holds one model. With a chat model active,
    // the old lookup returned null and the microphone reported "deploy an
    // audio model" even though one was already on the phone.
    expect(
      modelPathFor('voice', active: chat, installed: [chat, voice]),
      '/data/models/yamnet.tflite',
    );
  });

  test('a downloaded vision model is found while a chat model is active', () {
    expect(
      modelPathFor('camera', active: chat, installed: [chat, vision]),
      '/data/models/mobilenet.tflite',
    );
  });

  test('camera and microphone resolve independently of each other', () {
    final installed = [chat, voice, vision];
    expect(
      modelPathFor('voice', active: chat, installed: installed),
      '/data/models/yamnet.tflite',
    );
    expect(
      modelPathFor('camera', active: chat, installed: installed),
      '/data/models/mobilenet.tflite',
    );
  });

  test('backend audio task aliases resolve to the microphone runtime', () {
    expect(
      modelPathFor('voice', active: chat, installed: [chat, audio]),
      '/data/models/audioset.tflite',
    );
  });

  test(
    'newest downloaded matching model wins when active model is different',
    () {
      final oldVoice = _config('old-yamnet', 'voice');
      final newVoice = _config('new-yamnet', 'voice');
      expect(
        modelPathFor('voice', active: chat, installed: [oldVoice, newVoice]),
        '/data/models/new-yamnet.tflite',
      );
    },
  );

  test('null when nothing of that kind is installed', () {
    expect(
      modelPathFor('voice', active: chat, installed: [chat, vision]),
      isNull,
    );
    expect(modelPathFor('voice'), isNull);
  });

  test('a chat model is never offered to the camera or microphone', () {
    // .gguf cannot load in the TFLite runtime; handing it over would abort
    // the process natively.
    expect(modelPathFor('voice', active: chat, installed: [chat]), isNull);
    expect(modelPathFor('camera', active: chat, installed: [chat]), isNull);
  });

  test('a voice entry with a non-tflite path is rejected', () {
    final bogus = _config('weird', 'voice', ext: '.gguf');
    expect(modelPathFor('voice', active: bogus, installed: [bogus]), isNull);
  });

  test('the active model wins over an installed one of the same kind', () {
    final other = _config('yamnet2', 'voice');
    expect(
      modelPathFor('voice', active: voice, installed: [other, voice]),
      '/data/models/yamnet.tflite',
    );
  });
}
