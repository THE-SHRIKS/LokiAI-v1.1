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

Future<File> _makeTflite(Directory dir, String name, {String? marker}) async {
  final bytes = Uint8List(1024);
  bytes.setRange(4, 8, 'TFL3'.codeUnits);
  if (marker != null) {
    bytes.setRange(32, 32 + marker.length, marker.codeUnits);
  }
  final file = File('${dir.path}/$name');
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
      expect(ModelGuard.isShard('Llama-3.2-1B-Instruct-Q8_0.gguf'), isFalse);
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
      final file = await _makeGguf(
        temp,
        'good.gguf',
        sizeBytes: 25 * 1024 * 1024,
      );
      expect(await ModelGuard.validateGguf(file.path), isNull);
    });

    test('refuses a file that is too small to be a chat model', () async {
      // 9 MB is the size that passed the device budget in production.
      final file = await _makeGguf(
        temp,
        'tiny.gguf',
        sizeBytes: 9 * 1024 * 1024,
      );
      final rejection = await ModelGuard.validateGguf(file.path);
      expect(rejection?.code, 'MODEL_TOO_SMALL');
      expect(rejection!.message, contains('fragment'));
    });

    test('refuses a file that is not a GGUF at all', () async {
      final file = await _makeGguf(
        temp,
        'bogus.gguf',
        sizeBytes: 25 * 1024 * 1024,
        validMagic: false,
      );
      expect(
        (await ModelGuard.validateGguf(file.path))?.code,
        'MODEL_NOT_GGUF',
      );
    });

    test('refuses a shard whose filename does not admit it', () async {
      // Shard 1 carries split.count in its metadata even when renamed.
      final file = await _makeGguf(
        temp,
        'innocent-name.gguf',
        sizeBytes: 25 * 1024 * 1024,
        extraHeaderText: 'split.count',
      );
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

  group('audio TFLite validation', () {
    test('refuses Coral models before native interpreter loading', () async {
      final file = await _makeTflite(temp, 'yamnet_coral.tflite');
      final rejection = await ModelGuard.validateAudioTflite(file.path);
      expect(rejection?.code, 'AUDIO_MODEL_REQUIRES_EDGE_TPU');
    });

    test('refuses Edge TPU metadata even with an innocent filename', () async {
      final file = await _makeTflite(temp, 'sound.tflite', marker: 'EdgeTPU');
      expect(
        (await ModelGuard.validateAudioTflite(file.path))?.code,
        'AUDIO_MODEL_REQUIRES_EDGE_TPU',
      );
    });

    test(
      'accepts a standard TFLite header for interpreter validation',
      () async {
        final file = await _makeTflite(temp, 'yamnet.tflite');
        expect(await ModelGuard.validateAudioTflite(file.path), isNull);
      },
    );
  });

  group('native interrupted load recovery', () {
    test('a clean start quarantines nothing', () async {
      expect(await ModelGuard.recoverFromNativeCrash(), isNull);
    });

    test('a single interruption is a strike, not a quarantine', () async {
      const path = '/data/models/killer.gguf';
      // Simulates the process dying inside native code: beginLoad ran, endLoad
      // never did, because llama.cpp aborted the process.
      await ModelGuard.beginLoad(path);

      final recovered = await ModelGuard.recoverFromNativeCrash();

      expect(recovered, path);
      // One interruption alone must not disable the file — Android can kill
      // the process for reasons that have nothing to do with the model.
      expect(await ModelGuard.isQuarantined(path), isFalse);
      expect(
        Diagnostics.recent.map((r) => r.feature),
        contains('model.interrupted_load_recovered'),
      );
    });

    test(
      'a second consecutive interruption of the same file quarantines it',
      () async {
        const path = '/data/models/killer.gguf';
        await ModelGuard.beginLoad(path);
        await ModelGuard.recoverFromNativeCrash(); // strike 1: temporarily_failed
        expect(await ModelGuard.isQuarantined(path), isFalse);

        // Second launch attempts the same file again and it dies again.
        await ModelGuard.beginLoad(path);
        final recovered = await ModelGuard.recoverFromNativeCrash();

        expect(recovered, path);
        expect(await ModelGuard.isQuarantined(path), isTrue);
        expect(
          Diagnostics.recent.map((r) => r.feature),
          contains('model.quarantined_after_repeated_crash'),
        );
      },
    );

    test('a completed load leaves no marker behind', () async {
      const path = '/data/models/fine.gguf';
      await ModelGuard.beginLoad(path);
      await ModelGuard.endLoad(path);

      expect(await ModelGuard.recoverFromNativeCrash(), isNull);
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test(
      'a successful load between two interruptions resets the strike count',
      () async {
        const path = '/data/models/flaky.gguf';
        await ModelGuard.beginLoad(path);
        await ModelGuard.recoverFromNativeCrash(); // strike 1
        expect(await ModelGuard.isQuarantined(path), isFalse);

        // This launch's load actually succeeds.
        await ModelGuard.beginLoad(path);
        await ModelGuard.endLoad(path);
        expect(await ModelGuard.recoverFromNativeCrash(), isNull);

        // A third, later interruption is a fresh first strike, not quarantine.
        await ModelGuard.beginLoad(path);
        await ModelGuard.recoverFromNativeCrash();
        expect(await ModelGuard.isQuarantined(path), isFalse);
      },
    );

    test('recovery is idempotent across repeated launches', () async {
      const path = '/data/models/killer.gguf';
      await ModelGuard.beginLoad(path);

      expect(await ModelGuard.recoverFromNativeCrash(), path);
      // Second launch: no stale marker remains, so no new recovery is reported.
      expect(await ModelGuard.recoverFromNativeCrash(), isNull);
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test('quarantine can be cleared for a re-downloaded model', () async {
      const path = '/data/models/killer.gguf';
      await ModelGuard.beginLoad(path);
      await ModelGuard.recoverFromNativeCrash();
      await ModelGuard.beginLoad(path);
      await ModelGuard.recoverFromNativeCrash();
      expect(await ModelGuard.isQuarantined(path), isTrue);

      await ModelGuard.clearQuarantine(path);
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test('quarantine is per-file, not global', () async {
      await ModelGuard.beginLoad('/data/models/bad.gguf');
      await ModelGuard.recoverFromNativeCrash();
      await ModelGuard.beginLoad('/data/models/bad.gguf');
      await ModelGuard.recoverFromNativeCrash();

      expect(await ModelGuard.isQuarantined('/data/models/bad.gguf'), isTrue);
      expect(await ModelGuard.isQuarantined('/data/models/good.gguf'), isFalse);
    });

    // P0 incident, failure 2 (second-order damage): the inference service
    // dying mid-load left the load marker behind, and two service kills then
    // quarantined a model that had never actually failed.
    test('a service kill never quarantines the model, however often', () async {
      const path = '/data/models/innocent.gguf';
      for (var i = 0; i < 5; i++) {
        await ModelGuard.beginLoad(path);
        await ModelGuard.recoverFromNativeCrash(
          exitReason: 'INFERENCE_SERVICE_LOW_MEMORY_KILL',
        );
      }
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test('an unexplained service exit does not quarantine either', () async {
      const path = '/data/models/unknown-exit.gguf';
      await ModelGuard.beginLoad(path);
      await ModelGuard.recoverFromNativeCrash(
        exitReason: 'INFERENCE_SERVICE_UNKNOWN_EXIT',
      );
      await ModelGuard.beginLoad(path);
      await ModelGuard.recoverFromNativeCrash(
        exitReason: 'INFERENCE_SERVICE_UNKNOWN_EXIT',
      );
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test('discardLoadAttempt clears the marker without a strike', () async {
      const path = '/data/models/discarded.gguf';
      await ModelGuard.beginLoad(path);
      await ModelGuard.discardLoadAttempt(
        path,
        reason: 'INFERENCE_SERVICE_DISCONNECTED',
        evidence: const {'exit_evidence': {'reason_name': 'LOW_MEMORY'}},
      );
      // No stale marker survives, so startup recovery finds nothing to blame.
      expect(await ModelGuard.recoverFromNativeCrash(), isNull);
      expect(await ModelGuard.isQuarantined(path), isFalse);
    });

    test('a structured failure record is persisted for diagnosis', () async {
      const path = '/data/models/recorded.gguf';
      await ModelGuard.recordFailure(
        path: path,
        failureClass: 'INFERENCE_SERVICE_LOW_MEMORY_KILL',
        operation: 'load',
        evidence: const {'exit_evidence': {'reason_name': 'LOW_MEMORY'}},
        attributedToModel: false,
      );
      final log = await ModelGuard.failureLog();
      expect(log, isNotEmpty);
      final record = log.last;
      expect(record['failure_class'], 'INFERENCE_SERVICE_LOW_MEMORY_KILL');
      expect(record['exit_reason'], 'LOW_MEMORY');
      expect(record['operation'], 'load');
      expect(record['attributed_to_model'], isFalse);
      expect(record['evidence_level'], 'platform_confirmed');
      expect(record['adapter_version'], isNotNull);
      expect(record['runtime_version'], isNotNull);
      expect(record['timestamp'], isNotNull);
      // The artifact is fingerprinted, never stored as an absolute path.
      expect(record['artifact_fingerprint'], isNot(contains('/')));
    });

    test('a genuine native abort still quarantines after two strikes', () async {
      const path = '/data/models/really-bad.gguf';
      await ModelGuard.beginLoad(path);
      await ModelGuard.recoverFromNativeCrash();
      await ModelGuard.beginLoad(path);
      await ModelGuard.recoverFromNativeCrash();
      expect(await ModelGuard.isQuarantined(path), isTrue);
    });
  });
}
