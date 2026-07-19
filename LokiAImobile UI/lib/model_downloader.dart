import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

/// Downloads deployed models straight from the HuggingFace CDN into the
/// app's internal storage, verifies SHA-256, reports progress over the
/// WebSocket, and writes config.json (v3 wireless deployment, Tasks 2.5/2.6).
class ModelDownloader {
  static const int maxAttempts = 3;

  /// Entry point for a WebSocket "deploy" instruction.
  static Future<void> handleDeploy(
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

    String lastError = 'unknown error';
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // ignore: avoid_print
        print('VERIFICATION: download -> attempt $attempt/$maxAttempts '
            'url=$modelUrl');
        final saved = await _download(
            modelUrl, modelName, deploymentId, expectedSha, send);
        await _saveConfig(modelName, saved.path, config, deploymentId,
            saved.bytes, saved.sha256);
        send({
          'deployment_id': deploymentId,
          'status': 'complete',
          'progress_percent': 100,
          'error_message': null,
          'downloaded_bytes': saved.bytes,
          'sha256': saved.sha256,
          'model_path': saved.path,
        });
        // ignore: avoid_print
        print('VERIFICATION: download -> COMPLETE path=${saved.path} '
            'bytes=${saved.bytes} sha256=${saved.sha256}');
        return;
      } catch (e) {
        lastError = e.toString();
        // ignore: avoid_print
        print('VERIFICATION: download -> attempt $attempt failed: $lastError');
      }
    }

    send({
      'deployment_id': deploymentId,
      'status': 'failed',
      'progress_percent': 0,
      'error_message':
          'Download failed after $maxAttempts attempts: $lastError',
    });
  }

  static Future<({String path, int bytes, String sha256})> _download(
    String url,
    String filename,
    String deploymentId,
    String? expectedSha,
    void Function(Map<String, dynamic>) send,
  ) async {
    final docs = await getApplicationDocumentsDirectory();
    final modelsDir = Directory('${docs.path}/models');
    if (!await modelsDir.exists()) {
      await modelsDir.create(recursive: true);
    }
    final file = File('${modelsDir.path}/$filename');
    // Atomic download: stream into a .part file and only rename over the
    // live model after the hash checks out. An interrupted download can
    // never leave a truncated file at the real path.
    final partFile = File('${modelsDir.path}/$filename.part');

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30);
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      if (response.statusCode != 200) {
        throw HttpException(
            'HuggingFace CDN returned ${response.statusCode} for $url');
      }

      final totalBytes = response.contentLength;
      var receivedBytes = 0;
      var lastReported = -1;
      final shaSink = _Sha256Accumulator();

      final sink = partFile.openWrite();
      try {
        await for (final chunk in response
            .timeout(const Duration(seconds: 60))) {
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
              print('VERIFICATION: download -> $pct% '
                  '($receivedBytes/$totalBytes bytes)');
            }
          }
        }
        await sink.flush();
      } finally {
        await sink.close();
      }

      final actualSha = shaSink.digestHex();
      // ignore: avoid_print
      print('VERIFICATION: download -> saved ${partFile.path} '
          'bytes=$receivedBytes sha256=$actualSha expected=$expectedSha');

      if (expectedSha != null && expectedSha.isNotEmpty &&
          actualSha.toLowerCase() != expectedSha.toLowerCase()) {
        await partFile.delete();
        throw Exception(
            'SHA-256 mismatch: expected $expectedSha got $actualSha '
            '(corrupt file deleted)');
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
      client.close();
    }
  }

  /// Writes config.json to internal storage (spec Config JSON Format).
  /// model_size_bytes/model_sha256 let the loader detect corrupt files
  /// before handing them to native inference runtimes.
  static Future<void> _saveConfig(
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
      'deployed_at': DateTime.now().toUtc().toIso8601String(),
      'deployment_id': deploymentId,
      'model_size_bytes': sizeBytes,
      'model_sha256': sha256Hex,
    };
    await configFile.writeAsString(jsonEncode(json));
    // ignore: avoid_print
    print('VERIFICATION: config_receiver -> saved ${configFile.path}: '
        '${jsonEncode(json)}');
  }
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
    return _digestBytes
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
  }
}
