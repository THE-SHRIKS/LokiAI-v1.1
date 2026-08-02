import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/diagnostics.dart';
import 'package:lokiai_app/ml/model_guard.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Builds a file with a valid GGUF header and [sizeBytes] total length.
Future<File> _makeGguf(
  Directory dir,
  String name, {
  required int sizeBytes,
  bool validMagic = true,
  String? extraHeaderText,
}) async {
  final file = File('${dir.path}/$name');
  final bytes = Uint8List(sizeBytes);
  if (validMagic) {
    bytes.setRange(0, 4, 'GGUF'.codeUnits);
  } else {
    bytes.setRange(0, 4, 'NOPE'.codeUnits);
  }
  if (extraHeaderText != null) {
    bytes.setRange(32, 32 + extraHeaderText.length, extraHeaderText.codeUnits);
  }
  await file.writeAsBytes(bytes);
  return file;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory temp;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    Diagnostics.resetForTest();
    temp = await Directory.systemTemp.createTemp('loki_model_guard');
  });

  tearDown(() async {
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  group('split shard detection', () {
    test('recognises the exact file that crashed production', () {
      expect(
        ModelGuard.isShard('GLM-5.2-UD-IQ4_NL-00001-of-00009.gguf'),
        isTrue,
      );
    });

    test('recognises any llama.cpp shard name', () {
      expect(ModelGuard.isShard('/data/m/model-00003-of-00012.gguf'), isTrue);
    });

    test('does not flag ordinary single-file models', () {
      expect(
        ModelGuard.isShard('Llama-3.2-1B-Instruct-Q8_0.gguf'),
        isFalse,
      );
      expect(ModelGuard.isShard('mobilenet_v2.tflite'), isFalse);
    });

    test('a shard is refused before the file is even opened', () async {
      // No file is created: the name alone is disqualifying, which matters
      // because opening it is not what crashes - handing it to llama.cpp is.
      final rejection = await ModelGuard.validateGguf(
        '${temp.path}/GLM-5.2-UD-IQ4_NL-00001-of-00009.gguf',
      );
      expect(rejection, isNotNull);
      expect(rejection!.code, 'MODEL_IS_SPLIT_SHARD');
      expect(rejection.message, contains('multi-part'));
    });
  });

  group('file validation', () {
    test('accepts a plausible single-file GGUF', () async {
      final file = await _makeGguf(temp, 'good.gguf',
          sizeBytes: 25 * 1024 * 1024);
      expect(await ModelGuard.validateGguf(file.path), isNull);
    });

    test('refuses a file that is too small to be a chat model', () async {
      // 9 MB is the size that passed the device budget in production.
      final file = await _makeGguf(temp, 'tiny.gguf',
          sizeBytes: 9 * 1024 * 1024);
      final rejection = await ModelGuard.validateGguf(file.path);
      expect(rejection?.code, 'MODEL_TOO_SMALL');
      expect(rejection!.message, contains('fragment'));
    });

    test('refuses a file that is not a GGUF at all', () async {
      final file = await _makeGguf(temp, 'bogus.gguf',
          sizeBytes: 25 * 1024 * 1024, validMagic: false);
      expect((await ModelGuard.validateGguf(file.path))?.code, 'MODEL_NOT_GGUF');
    });

    test('refuses a shard whose filename does not admit it', () async {
      // Shard 1 carries split.count in its metadata even when renamed.
      final file = await _makeGguf(temp, 'innocent-name.gguf',
          sizeBytes: 25 * 1024 * 1024, extraHeaderText: 'split.count');
      expect(
        (await ModelGuard.validateGguf(file.path))?.code,
        'MODEL_IS_SPLIT_SHARD',
      );
    });

    test('refuses a missing file', () async {
      expect(
        (await ModelGuard.validateGguf('${temp.path}/nope.gguf'))?.code,
        'MODEL_FILE_MISSING',
      );
    });
  });

  group('native crash quarantine', () {
    test('a clean start quarantines nothing', () async {
      expect(await ModelGuard.recoverFromNativeCrash(), isNull);
    });

    test('a load that never ended is quarantined on the next start', () async {
      const path = '/data/models/killer.gguf';
      // Simulates the process dying inside native code: beginLoad ran, endLoad
      // never did, because llama.cpp aborted the process.
      await ModelGuard.beginLoad(path);

      final recovered = await ModelGuard.recoverFromNativeCrash();

      expect(recovered, path);
      expect(await ModelGuard.isQuarantined(path), isTrue);
      // The crash is recorded, not silently swallowed.
      expect(
        Diagnostics.recent.map((r) => r.feature),
        contains('model.native_crash_recovered'),
      );
    });

    test('a completed load leaves no marker behind', () async {
      const path = '/data/models/fine.gguf';
      await ModelGuard.beginLoad(path);
      await ModelGuard.endLoad();

      expect(await ModelGuard.recoverFromNativeCrash(), isNull);
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test('recovery is idempotent across repeated launches', () async {
      const path = '/data/models/killer.gguf';
      await ModelGuard.beginLoad(path);

      expect(await ModelGuard.recoverFromNativeCrash(), path);
      // Second launch: still quarantined, but no longer reported as a new crash.
      expect(await ModelGuard.recoverFromNativeCrash(), isNull);
      expect(await ModelGuard.isQuarantined(path), isTrue);
    });

    test('quarantine can be cleared for a re-downloaded model', () async {
      const path = '/data/models/killer.gguf';
      await ModelGuard.beginLoad(path);
      await ModelGuard.recoverFromNativeCrash();
      expect(await ModelGuard.isQuarantined(path), isTrue);

      await ModelGuard.clearQuarantine();
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test('quarantine is per-file, not global', () async {
      await ModelGuard.beginLoad('/data/models/bad.gguf');
      await ModelGuard.recoverFromNativeCrash();

      expect(await ModelGuard.isQuarantined('/data/models/bad.gguf'), isTrue);
      expect(await ModelGuard.isQuarantined('/data/models/good.gguf'), isFalse);
    });
  });
}
