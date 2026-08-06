import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';
import 'package:tflite_flutter/tflite_flutter.dart';

import 'ml/chat_inference.dart';
import 'ml/model_guard.dart';
import 'ml/voice_inference.dart';

/// Downloads deployed models straight from the HuggingFace CDN into the
/// app's internal storage, verifies SHA-256, reports progress over the
/// WebSocket, and writes config.json (v3 wireless deployment, Tasks 2.5/2.6).
class ModelDownloader {
  static const int maxAttempts = 3;
  static const int maxInstalledModels = 10;
  // Validation is one bounded local operation (one chat generation or one
  // TFLite invoke) — it either finishes in seconds or has hung/crashed.
  // Bounding it here catches a Dart-level hang; a genuine native crash
  // still kills the process outright (nothing in Dart can catch that), but
  // the backend's own status-aware staleness timeout is the backstop for
  // that case, and it no longer waits 15 minutes to notice.
  static const Duration _validationTimeout = Duration(seconds: 60);
  static final Set<String> _cancelledDeployments = <String>{};
  static final Map<String, HttpClient> _activeClients = <String, HttpClient>{};

  // Every deployment_id this phone is currently actually working on (from
  // the instant handleDeploy is entered until its one terminal status is
  // sent). Lets backend_connection.dart answer, authoritatively, "is the
  // phone doing anything for this id right now?" when the backend's
  // state_ack lists a deployment it still considers in flight — without
  // this the phone had no way to tell the backend "I have no record of
  // that deployment" and a stale backend row could only ever resolve by
  // waiting out the staleness timeout.
  static final Set<String> _inFlightDeployments = <String>{};

  /// True while [deploymentId] is actively being downloaded/validated by
  /// this phone right now.
  static bool isInFlight(String deploymentId) =>
      _inFlightDeployments.contains(deploymentId);

  /// Stops an active download immediately when the dashboard cancels it.
  /// Closing the client aborts a blocked network read; the existing cleanup
  /// path then removes the partial file.
  static void cancel(String deploymentId) {
    _cancelledDeployments.add(deploymentId);
    _activeClients.remove(deploymentId)?.close(force: true);
  }

  /// Reduces a server-supplied model_name to a bare, safe filename.
  ///
  /// model_name arrives over the WebSocket and was previously concatenated
  /// straight into a filesystem path, so a value like "../../shared_prefs/x"
  /// would have written outside the models directory. Strips any directory
  /// component and anything outside a conservative character set.
  static String sanitizeFilename(String raw) {
    // Take the last path segment only — kills ../, absolute paths, and both
    // separator styles in one step.
    var name =
        raw.split(RegExp(r'[/\\]')).where((s) => s.isNotEmpty).lastOrNull ?? '';
    name = name.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    // '.'/'..' survive the character filter but are not usable filenames.
    while (name.startsWith('.')) {
      name = name.substring(1);
    }
    if (name.isEmpty) name = 'model.bin';
    return name;
  }

  /// Entry point for a WebSocket "deploy" instruction. Tracks
  /// [deploymentId] as in-flight for the duration of the whole handler so
  /// [isInFlight] is authoritative for backend_connection.dart's state_ack
  /// handling, regardless of which of the many exit paths below this run
  /// actually takes.
  static Future<void> handleDeploy(
    Map<String, dynamic> data,
    void Function(Map<String, dynamic>) send,
  ) async {
    final trackedId = data['deployment_id'] as String? ?? '';
    if (trackedId.isNotEmpty) _inFlightDeployments.add(trackedId);
    try {
      await _handleDeployInternal(data, send);
    } finally {
      if (trackedId.isNotEmpty) _inFlightDeployments.remove(trackedId);
    }
  }

  static Future<void> _handleDeployInternal(
    Map<String, dynamic> data,
    void Function(Map<String, dynamic>) send,
  ) async {
    final deploymentId = data['deployment_id'] as String? ?? '';
    final modelUrl = data['model_url'] as String? ?? '';
    final modelName = data['model_name'] as String? ?? '';
    final expectedSha = data['model_sha256'] as String?;
    final config = data['config'] is Map<String, dynamic>
        ? data['config'] as Map<String, dynamic>
        : <String, dynamic>{};

    if (deploymentId.isEmpty || modelUrl.isEmpty || modelName.isEmpty) {
      send({
        'deployment_id': deploymentId,
        'status': 'failed',
        'progress_percent': 0,
        'error_message':
            'Deployment instruction missing deployment_id/model_url/model_name',
      });
      return;
    }

    if (_cancelledDeployments.remove(deploymentId)) {
      send({
        'deployment_id': deploymentId,
        'status': 'cancelled',
        'progress_percent': 0,
        'error_message': 'Cancelled by user',
      });
      return;
    }

    final limitError = await _deploymentLimitError(deploymentId);
    if (limitError != null) {
      send({
        'deployment_id': deploymentId,
        'status': 'failed',
        'progress_percent': 0,
        'error_message': limitError,
      });
      return;
    }

    // Only the download itself is retried. A transient network blip is
    // exactly what maxAttempts exists for; a validation failure is not —
    // re-downloading the identical bytes and smoke-testing them again would
    // only reproduce the same failure, and previously it silently did
    // exactly that: a validation exception was caught by the SAME retry
    // block as download failures, so the backend never learned validation
    // had failed until all attempts were burned re-downloading a file that
    // was never the problem — or, if the process died natively mid-
    // validation instead of throwing a catchable Dart exception, no
    // terminal status was ever sent at all and the deployment sat at
    // "downloaded" forever, blocking every later deployment on the device.
    String lastError = 'unknown error';
    ({String path, int bytes, String sha256})? saved;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // ignore: avoid_print
        print(
          'VERIFICATION: download -> attempt $attempt/$maxAttempts '
          'url=$modelUrl',
        );
        saved = await _download(modelUrl, modelName, deploymentId, expectedSha, send);
        if (_cancelledDeployments.remove(deploymentId)) {
          send({
            'deployment_id': deploymentId,
            'status': 'cancelled',
            'progress_percent': 0,
            'error_message': 'Cancelled by user',
          });
          return;
        }
        break;
      } catch (e) {
        if (_cancelledDeployments.remove(deploymentId)) {
          send({
            'deployment_id': deploymentId,
            'status': 'cancelled',
            'progress_percent': 0,
            'error_message': 'Cancelled by user',
          });
          return;
        }
        lastError = e.toString();
        // ignore: avoid_print
        print('VERIFICATION: download -> attempt $attempt failed: $lastError');
      }
    }

    if (saved == null) {
      send({
        'deployment_id': deploymentId,
        'status': 'failed',
        'progress_percent': 0,
        'error_message':
            'Download failed after $maxAttempts attempts: $lastError',
      });
      return;
    }

    // Validation runs exactly once, with a hard ceiling: whatever happens
    // inside it — a Dart exception, an unexpected hang, a timeout — this
    // block guarantees exactly one terminal status reaches the backend, so
    // "downloaded"/"validating" can never again be the last thing the
    // backend hears about a deployment that has actually stopped.
    try {
      final savedConfig = await _saveConfig(
        sanitizeFilename(modelName),
        saved.path,
        config,
        deploymentId,
        saved.bytes,
        saved.sha256,
      );
      await _recordInstalledModel(savedConfig);
      send({
        'deployment_id': deploymentId,
        'status': 'downloaded',
        'progress_percent': 100,
        'error_message': null,
        'downloaded_bytes': saved.bytes,
        'sha256': saved.sha256,
        'model_path': saved.path,
      });
      send({
        'deployment_id': deploymentId,
        'status': 'validating',
        'progress_percent': 100,
        'error_message': null,
      });
      final validation = await _validateRuntimeArtifact(
        saved.path,
        savedConfig,
        data,
      ).timeout(
        _validationTimeout,
        onTimeout: () => _RuntimeValidationResult(
          success: false,
          errorCode: 'MODEL_SMOKE_TEST_TIMEOUT',
          errorDetail: 'Runtime validation did not finish within '
              '${_validationTimeout.inSeconds}s.',
          runtimeEvent: {
            'type': 'runtime_event',
            'event_id': '$deploymentId:validation-timeout:${saved!.sha256}',
            'schema_version': 1,
            'deployment_id': deploymentId,
            'model_id': savedConfig['model_name'],
            'adapter_id': savedConfig['adapter_id'],
            'adapter_version': savedConfig['adapter_version'],
            'runtime_version': 'lokiai_android_runtime_1',
            'operation': 'deployment_validation',
            'event_type': 'runtime_validation',
            'success': false,
            'error_code': 'MODEL_SMOKE_TEST_TIMEOUT',
            'error_detail': 'Runtime validation did not finish within '
                '${_validationTimeout.inSeconds}s.',
            'occurred_at': DateTime.now().toUtc().toIso8601String(),
          },
        ),
      );
      send(validation.runtimeEvent);
      if (!validation.success) {
        send({
          'deployment_id': deploymentId,
          'status': 'failed',
          'progress_percent': 100,
          'error_message': validation.errorDetail,
          'error_code': validation.errorCode,
          'error_detail': validation.errorDetail,
        });
        return;
      }
      send({
        'deployment_id': deploymentId,
        'status': 'complete',
        'progress_percent': 100,
        'error_message': null,
        'runtime_verified': true,
        'smoke_test_success': true,
        'validation_result': validation.runtimeEvent,
        'smoke_test_result': validation.runtimeEvent,
        'downloaded_bytes': saved.bytes,
        'sha256': saved.sha256,
        'model_path': saved.path,
      });
      // ignore: avoid_print
      print(
        'VERIFICATION: download -> COMPLETE path=${saved.path} '
        'bytes=${saved.bytes} sha256=${saved.sha256}',
      );
    } catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: validation -> failed: $e');
      send({
        'deployment_id': deploymentId,
        'status': 'failed',
        'progress_percent': 100,
        'error_message': 'Runtime validation failed: $e',
        'error_code': 'MODEL_SMOKE_TEST_FAILED',
        'error_detail': e.toString(),
      });
    }
  }

  static Future<({String path, int bytes, String sha256})> _download(
    String url,
    String filename,
    String deploymentId,
    String? expectedSha,
    void Function(Map<String, dynamic>) send,
  ) async {
    final docs = await getApplicationDocumentsDirectory();
    // Each deployment gets its OWN directory, keyed by deployment_id — not a
    // single flat models/ folder keyed only by filename. Many HuggingFace
    // GGUF/TFLite repos ship files with generic, colliding basenames (e.g.
    // "model.gguf", "model.tflite"); two different deployed models sharing
    // that basename used to overwrite the exact same on-disk file, so the
    // FIRST model's registry entry silently started pointing at the SECOND
    // model's bytes (or a corrupt half-written file if the second download
    // raced the first). This is what made "deploy model B" appear to make
    // model A disappear or corrupt. A per-deployment directory makes that
    // collision structurally impossible, matching the multi-model registry's
    // own on-disk layout (models/<local_model_id>/...).
    final modelsDir = Directory('${docs.path}/models/${sanitizeFilename(deploymentId)}');
    if (!await modelsDir.exists()) {
      await modelsDir.create(recursive: true);
    }
    // Never trust the server-supplied name as a path (see sanitizeFilename).
    final safeName = sanitizeFilename(filename);
    final file = File('${modelsDir.path}/$safeName');
    // Atomic download: stream into a .part file and only rename over the
    // live model after the hash checks out. An interrupted download can
    // never leave a truncated file at the real path.
    final partFile = File('${modelsDir.path}/$safeName.part');

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30);
    _activeClients[deploymentId] = client;
    try {
      if (_cancelledDeployments.contains(deploymentId)) {
        throw const HttpException('Download cancelled by user');
      }
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      if (response.statusCode != 200) {
        throw HttpException(
          'HuggingFace CDN returned ${response.statusCode} for $url',
        );
      }

      final totalBytes = response.contentLength;
      var receivedBytes = 0;
      var lastReported = -1;
      final shaSink = _Sha256Accumulator();

      final sink = partFile.openWrite();
      try {
        await for (final chunk in response.timeout(
          const Duration(seconds: 60),
        )) {
          if (_cancelledDeployments.contains(deploymentId)) {
            throw const HttpException('Download cancelled by user');
          }
          sink.add(chunk);
          shaSink.add(chunk);
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            final pct = (receivedBytes / totalBytes * 100).floor();
            // Report in ~10% steps to keep WS traffic sane.
            if (pct >= lastReported + 10 && pct < 100) {
              lastReported = pct;
              send({
                'deployment_id': deploymentId,
                'status': 'downloading',
                'progress_percent': pct,
                'error_message': null,
              });
              // ignore: avoid_print
              print(
                'VERIFICATION: download -> $pct% '
                '($receivedBytes/$totalBytes bytes)',
              );
            }
          }
        }
        await sink.flush();
      } finally {
        await sink.close();
      }

      final actualSha = shaSink.digestHex();
      // ignore: avoid_print
      print(
        'VERIFICATION: download -> saved ${partFile.path} '
        'bytes=$receivedBytes sha256=$actualSha expected=$expectedSha',
      );

      if (expectedSha != null &&
          expectedSha.isNotEmpty &&
          actualSha.toLowerCase() != expectedSha.toLowerCase()) {
        await partFile.delete();
        throw Exception(
          'SHA-256 mismatch: expected $expectedSha got $actualSha '
          '(corrupt file deleted)',
        );
      }

      await partFile.rename(file.path);
      return (path: file.path, bytes: receivedBytes, sha256: actualSha);
    } catch (e) {
      if (await partFile.exists()) {
        try {
          await partFile.delete();
        } catch (_) {}
      }
      rethrow;
    } finally {
      if (identical(_activeClients[deploymentId], client)) {
        _activeClients.remove(deploymentId);
      }
      client.close();
    }
  }

  /// Writes config.json to internal storage (spec Config JSON Format).
  /// model_size_bytes/model_sha256 let the loader detect corrupt files
  /// before handing them to native inference runtimes.
  static Future<Map<String, dynamic>> _saveConfig(
    String modelName,
    String modelPath,
    Map<String, dynamic> config,
    String deploymentId,
    int sizeBytes,
    String sha256Hex,
  ) async {
    final docs = await getApplicationDocumentsDirectory();
    final configFile = File('${docs.path}/config.json');
    final format = modelName.contains('.')
        ? modelName.split('.').last.toLowerCase()
        : 'unknown';
    final json = {
      'model_name': modelName,
      'model_path': modelPath,
      'inference_mode': config['inference_mode'] ?? 'camera',
      'format': format,
      'confidence_threshold':
          (config['confidence_threshold'] as num?)?.toDouble() ?? 0.75,
      'adapter_id': config['adapter_id'],
      'adapter_version': config['adapter_version'],
      'compatibility': config['compatibility'],
      'deployed_at': DateTime.now().toUtc().toIso8601String(),
      'deployment_id': deploymentId,
      'model_size_bytes': sizeBytes,
      'model_sha256': sha256Hex,
    };
    await configFile.writeAsString(jsonEncode(json));
    // ignore: avoid_print
    print(
      'VERIFICATION: config_receiver -> saved ${configFile.path}: '
      '${jsonEncode(json)}',
    );
    return json;
  }

  /// Keeps a small local index so the user can switch between models already
  /// downloaded to the phone without downloading them again.
  static Future<void> _recordInstalledModel(Map<String, dynamic> config) async {
    final docs = await getApplicationDocumentsDirectory();
    final registryFile = File('${docs.path}/model-registry.json');
    List<dynamic> registry = [];
    if (await registryFile.exists()) {
      try {
        final decoded = jsonDecode(await registryFile.readAsString());
        if (decoded is List) registry = decoded;
      } catch (_) {}
    }
    registry.removeWhere(
      (item) => item is Map && item['deployment_id'] == config['deployment_id'],
    );
    registry.add(config);
    await registryFile.writeAsString(jsonEncode(registry));
  }

  static Future<String?> _deploymentLimitError(String deploymentId) async {
    final docs = await getApplicationDocumentsDirectory();
    final registryFile = File('${docs.path}/model-registry.json');
    if (!await registryFile.exists()) return null;
    List<dynamic> registry = const [];
    try {
      final decoded = jsonDecode(await registryFile.readAsString());
      if (decoded is List) registry = decoded;
    } catch (_) {
      return null;
    }

    var readyCount = 0;
    var replacingExisting = false;
    for (final item in registry) {
      if (item is! Map) continue;
      if (item['deployment_id'] == deploymentId) {
        replacingExisting = true;
        continue;
      }
      final path = item['model_path'] as String?;
      if (path == null || path.isEmpty || path.endsWith('.part')) continue;
      final file = File(path);
      if (await file.exists()) readyCount++;
    }
    if (!replacingExisting && readyCount >= maxInstalledModels) {
      return 'This phone already has $maxInstalledModels downloaded models. '
          'Remove an old model before deploying another one.';
    }
    return null;
  }

  static Future<_RuntimeValidationResult> _validateRuntimeArtifact(
    String modelPath,
    Map<String, dynamic> config,
    Map<String, dynamic> instruction,
  ) async {
    final deploymentId = config['deployment_id'] as String? ?? '';
    final adapterId =
        (instruction['adapter_id'] as String?) ??
        (config['adapter_id'] as String?) ??
        ((config['format'] == 'gguf')
            ? 'llama_cpp_gguf_chat_v1'
            : 'unknown');
    final adapterVersion =
        (instruction['adapter_version'] as String?) ??
        (config['adapter_version'] as String?) ??
        '1';
    final now = DateTime.now().toUtc().toIso8601String();
    // Structural checks alone (extension/header/size) prove a file COULD be
    // handed to native code, not that native code can run it. Every branch
    // below performs an actual bounded native call — context+first-token for
    // chat, interpreter+zero-tensor invoke for TFLite — before this
    // deployment is ever reported to the backend as ready.
    ModelRejection? rejection;
    if (adapterId == 'llama_cpp_gguf_chat_v1') {
      rejection = await _smokeTestChat(modelPath);
    } else if (adapterId == 'tflite_yamnet_audio_v1') {
      // Uses the SAME gate the real microphone runtime uses
      // (VoiceInference.validateAndProbe) — exact tensor contract, exact
      // known-adapter signature, exact label contract, and a real inference
      // through the exact production preprocessing/postprocessing path on a
      // synthetic waveform. A model that fails this can never be shown as
      // ready and then rejected by mic_feature.dart later; the two paths
      // share one implementation, not two independent opinions.
      final probe = await VoiceInference.validateAndProbe(modelPath);
      try {
        rejection = probe.rejection;
      } finally {
        try {
          probe.interpreter?.close();
        } catch (_) {}
      }
    } else if (adapterId == 'tflite_imagenet_classifier_v1') {
      rejection =
          await ModelGuard.validateVisionTflite(modelPath) ??
          await _smokeTestTflite(modelPath, label: 'vision');
    } else {
      rejection = ModelRejection(
        'RUNTIME_ADAPTER_UNSUPPORTED',
        'This Android build does not implement adapter $adapterId.',
      );
    }
    final success = rejection == null;
    final event = <String, dynamic>{
      'type': 'runtime_event',
      'event_id':
          '$deploymentId:${success ? 'validation-ok' : 'validation-failed'}:${config['model_sha256'] ?? ''}',
      'schema_version': 1,
      'deployment_id': deploymentId,
      'model_id': config['model_name'],
      'adapter_id': adapterId,
      'adapter_version': adapterVersion,
      'runtime_version': 'lokiai_android_runtime_1',
      'operation': 'deployment_validation',
      'event_type': 'runtime_validation',
      'success': success,
      'error_code': rejection?.code,
      'error_detail': rejection?.message,
      'occurred_at': now,
    };
    return _RuntimeValidationResult(
      success: success,
      errorCode: rejection?.code,
      errorDetail: rejection?.message,
      runtimeEvent: event,
    );
  }
}

class _RuntimeValidationResult {
  final bool success;
  final String? errorCode;
  final String? errorDetail;
  final Map<String, dynamic> runtimeEvent;

  const _RuntimeValidationResult({
    required this.success,
    required this.errorCode,
    required this.errorDetail,
    required this.runtimeEvent,
  });
}

/// Loads the model into a throwaway [ChatInference] and drives its real,
/// public load-then-generate path — context creation, then an actual bounded
/// generation through the exact same `generateText` production code path a
/// real chat message uses — before disposing it. Deliberately does not touch
/// [ChatInference]'s private load internals: this is a second, independent
/// caller of the one public API surface, not a parallel implementation that
/// could drift from what real chat actually does.
Future<ModelRejection?> _smokeTestChat(String modelPath) async {
  final probe = ChatInference();
  try {
    await probe.initialize(modelPath);
    if (!probe.isReady) {
      return ModelRejection(
        'CHAT_CONTEXT_CREATE_FAILED',
        probe.failureMessage ?? 'The chat model failed a startup validation check.',
      );
    }
    final tokens = <String>[];
    try {
      await probe
          .generateText('Hi')
          .timeout(
            const Duration(seconds: 45),
            onTimeout: (sink) => sink.close(),
          )
          .forEach(tokens.add);
    } catch (e) {
      return ModelRejection(
        'CHAT_GENERATION_FAILED',
        'This chat model loaded but failed a bounded smoke generation on '
            'this device ($e).',
      );
    }
    if (tokens.isEmpty) {
      return ModelRejection(
        'CHAT_GENERATION_FAILED',
        'This chat model loaded but produced no output on a bounded smoke '
            'generation.',
      );
    }
    return null;
  } finally {
    await probe.dispose();
  }
}

/// Opens a throwaway TFLite [Interpreter] and invokes it once on an
/// all-zero input tensor shaped to the model's own declared shape/dtype.
/// Proves the file is a real, loadable, invocable interpreter — not just a
/// file with the right header — before it is ever reported as ready.
Future<ModelRejection?> _smokeTestTflite(
  String modelPath, {
  required String label,
}) async {
  Interpreter? interpreter;
  try {
    interpreter = Interpreter.fromFile(File(modelPath));
    interpreter.allocateTensors();
    final inTensor = interpreter.getInputTensor(0);
    final outTensor = interpreter.getOutputTensor(0);
    if (inTensor.shape.any((d) => d <= 0) ||
        outTensor.shape.any((d) => d <= 0)) {
      return ModelRejection(
        '${label.toUpperCase()}_TENSOR_CONTRACT_MISMATCH',
        'This $label model has a dynamic or invalid tensor shape LokiAI '
            'cannot bind to a fixed smoke test.',
      );
    }
    // Matched by string, not enum member, on purpose: the same pattern the
    // live vision isolate uses (see vision_engine.dart) to stay agnostic of
    // exactly which TensorType values this plugin version exposes.
    final quantizedIn = inTensor.type.toString().contains('int8');
    final quantizedOut = outTensor.type.toString().contains('int8');
    final input = _zeroBuffer(inTensor.shape, asInt: quantizedIn);
    final output = _zeroBuffer(outTensor.shape, asInt: quantizedOut);
    interpreter.run(input, output);
    return null;
  } catch (e) {
    return ModelRejection(
      '${label.toUpperCase()}_INFERENCE_FAILED',
      'This $label model could not complete a bounded smoke inference on '
          'this device ($e).',
    );
  } finally {
    try {
      interpreter?.close();
    } catch (_) {}
  }
}

/// Nested zero-filled buffer matching an arbitrary tensor shape, e.g. `[1,
/// 224, 224, 3]` -> a 4-deep nested List. Mirrors the same shape-generic
/// pattern the live vision isolate uses, so a smoke test that passes here
/// exercises the identical tensor layout the real interpreter will see.
dynamic _zeroBuffer(List<int> shape, {required bool asInt}) {
  if (shape.length == 1) {
    return asInt ? List<int>.filled(shape[0], 0) : List<double>.filled(shape[0], 0.0);
  }
  return List.generate(shape[0], (_) => _zeroBuffer(shape.sublist(1), asInt: asInt));
}

/// Incremental SHA-256 so huge model files never sit in memory twice.
class _Sha256Accumulator {
  final List<int> _digestBytes = [];
  late final ByteConversionSink _input;

  _Sha256Accumulator() {
    final output = ChunkedConversionSink<Digest>.withCallback((digests) {
      _digestBytes.addAll(digests.single.bytes);
    });
    _input = sha256.startChunkedConversion(output);
  }

  void add(List<int> chunk) => _input.add(chunk);

  String digestHex() {
    _input.close();
    return _digestBytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }
}
