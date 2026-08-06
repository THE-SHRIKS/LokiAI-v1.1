import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../diagnostics.dart';

/// Why a model file was refused, or null when it is safe to load.
class ModelRejection {
  final String code;
  final String message;
  const ModelRejection(this.code, this.message);
  @override
  String toString() => '$code: $message';
}

/// Pre-flight validation and crash quarantine for native model runtimes.
///
/// llama.cpp and TFLite run as native code. When they are handed a file they
/// cannot use they do not throw a Dart exception — they abort the process.
/// No `try`/`catch` anywhere in Dart can intercept that, which is why the app
/// "just crashes when you type": the deployed file was
/// `GLM-5.2-UD-IQ4_NL-00001-of-00009.gguf`, one 9 MB shard of a nine-part
/// model, and llama.cpp dies on it in native code.
///
/// Two defences, because prevention alone can never be complete:
///
///  1. [validateGguf] refuses files that cannot possibly load — a split shard,
///     something that is not a GGUF at all, or a file far too small to be a
///     chat model.
///  2. [beginLoad] / [endLoad] wrap the native call in a persisted marker. If
///     the process dies inside native code the marker survives, and the next
///     launch records a strike against that exact file. One interruption is
///     not proof of a bad model — Android can kill the process for unrelated
///     reasons (OOM, update, force-stop) — so a single strike only marks the
///     file "temporarily failed" and a retry is still allowed. A SECOND
///     consecutive interruption of the same file, with no successful load in
///     between, quarantines it: [isQuarantined] then refuses to hand it to
///     native code again until [clearQuarantine] is called (e.g. after a
///     fresh re-deploy). A bad model can therefore take the app down at most
///     twice, never more, and is never impossible to reopen.
class ModelGuard {
  ModelGuard._();

  /// llama.cpp's split naming convention, e.g. `-00001-of-00009.gguf`.
  /// Loading one shard alone is always fatal: the tensors live across all of
  /// them and the loader aborts when it cannot find the rest.
  static final RegExp _shardPattern = RegExp(
    r'-\d{5}-of-\d{5}\.gguf$',
    caseSensitive: false,
  );

  /// A GGUF chat model below this is a fragment, an adapter, a vocab-only
  /// file, or a shard — never something llama.cpp can converse with.
  static const int _minChatModelBytes = 20 * 1024 * 1024;

  static const String _pendingKey = 'loki_model_load_pending_v1';
  static const String _quarantineKey = 'loki_model_quarantine_v1';
  static const String _healthKey = 'loki_model_health_v2';

  static bool isShard(String path) => _shardPattern.hasMatch(path);

  /// Validates a GGUF file before it is handed to native code.
  /// Returns null when the file is safe to load.
  static Future<ModelRejection?> validateGguf(String path) async {
    final file = File(path);

    if (isShard(path)) {
      return const ModelRejection(
        'MODEL_IS_SPLIT_SHARD',
        'This is one part of a multi-part model, not a complete one. '
            'LokiAI can only run single-file models. Deploy a smaller '
            'single-file model from the dashboard.',
      );
    }

    if (!await file.exists()) {
      return const ModelRejection(
        'MODEL_FILE_MISSING',
        'The deployed model file is missing. Re-deploy it from the dashboard.',
      );
    }

    final int length;
    try {
      length = await file.length();
    } catch (e) {
      return ModelRejection(
        'MODEL_FILE_UNREADABLE',
        'The deployed model file could not be read ($e).',
      );
    }

    if (length < _minChatModelBytes) {
      return ModelRejection(
        'MODEL_TOO_SMALL',
        'This file is only ${(length / (1024 * 1024)).toStringAsFixed(1)} MB, '
            'which is too small to be a working chat model - it is most likely '
            'a fragment of a larger one. Deploy a complete model instead.',
      );
    }

    // Header check: magic bytes, then a scan for llama.cpp's split metadata
    // key, which is present in shard 1 even when the filename does not say so.
    try {
      final handle = await file.open();
      try {
        final header = await handle.read(1024 * 64);
        if (header.length < 8) {
          return const ModelRejection(
            'MODEL_TRUNCATED',
            'The deployed model file is truncated. Re-deploy it.',
          );
        }
        if (!_hasGgufMagic(header)) {
          return const ModelRejection(
            'MODEL_NOT_GGUF',
            'This file is not a GGUF model, so the chat runtime cannot load '
                'it. Deploy a .gguf chat model from the dashboard.',
          );
        }
        if (_containsAscii(header, 'split.count')) {
          return const ModelRejection(
            'MODEL_IS_SPLIT_SHARD',
            'This model is published in multiple parts, which LokiAI cannot '
                'run. Deploy a single-file model from the dashboard.',
          );
        }
      } finally {
        await handle.close();
      }
    } catch (e) {
      return ModelRejection(
        'MODEL_HEADER_UNREADABLE',
        'The deployed model could not be inspected before loading ($e).',
      );
    }

    return null;
  }

  /// Validates the subset of TFLite audio models this app can actually run.
  /// Coral/Edge-TPU exports require a native delegate the app does not ship.
  static Future<ModelRejection?> validateAudioTflite(String path) async {
    final file = File(path);
    final lowerPath = path.toLowerCase();
    if (lowerPath.contains('coral') ||
        lowerPath.contains('edgetpu') ||
        lowerPath.contains('edge_tpu') ||
        lowerPath.contains('edge-tpu')) {
      return const ModelRejection(
        'AUDIO_MODEL_REQUIRES_EDGE_TPU',
        'This audio model is built for Coral Edge TPU hardware, which this '
            'phone cannot use. Deploy a standard CPU TFLite audio model from '
            'the dashboard.',
      );
    }
    if (!await file.exists()) {
      return const ModelRejection(
        'MODEL_FILE_MISSING',
        'The deployed audio model file is missing. Re-deploy it from the dashboard.',
      );
    }
    try {
      final builder = BytesBuilder(copy: false);
      await for (final chunk in file.openRead(0, 128 * 1024)) {
        builder.add(chunk);
      }
      final bytes = builder.toBytes();
      if (bytes.length < 8 ||
          bytes[4] != 0x54 ||
          bytes[5] != 0x46 ||
          bytes[6] != 0x4c ||
          bytes[7] != 0x33) {
        return const ModelRejection(
          'AUDIO_MODEL_NOT_TFLITE',
          'The deployed audio file is not a valid TFLite model. Re-deploy it from the dashboard.',
        );
      }
      if (_containsAsciiIgnoreCase(bytes, 'edgetpu') ||
          _containsAsciiIgnoreCase(bytes, 'coral')) {
        return const ModelRejection(
          'AUDIO_MODEL_REQUIRES_EDGE_TPU',
          'This audio model requires Coral Edge TPU hardware. Deploy a standard CPU TFLite audio model instead.',
        );
      }
    } catch (e) {
      return ModelRejection(
        'AUDIO_MODEL_UNREADABLE',
        'The deployed audio model could not be inspected ($e). Re-deploy it.',
      );
    }
    return null;
  }

  /// Validates the subset of TFLite vision models this app can safely hand to
  /// the bundled TensorFlow Lite runtime. Exact tensor contracts are checked by
  /// VisionEngine when the interpreter opens; this gate prevents obvious
  /// corrupt/unsupported artifacts from becoming "ready" after download.
  static Future<ModelRejection?> validateVisionTflite(String path) async {
    final file = File(path);
    final lowerPath = path.toLowerCase();
    if (lowerPath.contains('coral') ||
        lowerPath.contains('edgetpu') ||
        lowerPath.contains('edge_tpu') ||
        lowerPath.contains('edge-tpu')) {
      return const ModelRejection(
        'VISION_MODEL_REQUIRES_EDGE_TPU',
        'This vision model requires Coral Edge TPU hardware. Deploy a standard CPU TFLite model instead.',
      );
    }
    if (!await file.exists()) {
      return const ModelRejection(
        'VISION_MODEL_FILE_MISSING',
        'The deployed vision model file is missing. Re-deploy it from the dashboard.',
      );
    }
    try {
      final builder = BytesBuilder(copy: false);
      await for (final chunk in file.openRead(0, 128 * 1024)) {
        builder.add(chunk);
      }
      final bytes = builder.toBytes();
      if (bytes.length < 8 ||
          bytes[4] != 0x54 ||
          bytes[5] != 0x46 ||
          bytes[6] != 0x4c ||
          bytes[7] != 0x33) {
        return const ModelRejection(
          'VISION_MODEL_NOT_TFLITE',
          'The deployed vision file is not a valid TFLite model. Re-deploy it from the dashboard.',
        );
      }
      if (_containsAsciiIgnoreCase(bytes, 'edgetpu') ||
          _containsAsciiIgnoreCase(bytes, 'coral')) {
        return const ModelRejection(
          'VISION_MODEL_REQUIRES_EDGE_TPU',
          'This vision model requires Coral Edge TPU hardware. Deploy a standard CPU TFLite model instead.',
        );
      }
    } catch (e) {
      return ModelRejection(
        'VISION_MODEL_UNREADABLE',
        'The deployed vision model could not be inspected ($e). Re-deploy it.',
      );
    }
    return null;
  }

  static bool _hasGgufMagic(Uint8List header) =>
      header.length >= 4 &&
      header[0] == 0x47 && // G
      header[1] == 0x47 && // G
      header[2] == 0x55 && // U
      header[3] == 0x46; // F

  static bool _containsAscii(Uint8List haystack, String needle) {
    final bytes = needle.codeUnits;
    outer:
    for (var i = 0; i + bytes.length <= haystack.length; i++) {
      for (var j = 0; j < bytes.length; j++) {
        if (haystack[i + j] != bytes[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  static bool _containsAsciiIgnoreCase(Uint8List haystack, String needle) {
    final bytes = needle.toLowerCase().codeUnits;
    outer:
    for (var i = 0; i + bytes.length <= haystack.length; i++) {
      for (var j = 0; j < bytes.length; j++) {
        final value = haystack[i + j];
        final lower = value >= 0x41 && value <= 0x5a ? value + 0x20 : value;
        if (lower != bytes[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  static const String _healthStatusQuarantined = 'quarantined';
  static const String _healthStatusTemporarilyFailed = 'temporarily_failed';

  /// The current health entry for [path], or null when it has none.
  static Future<_HealthEntry?> _healthFor(String path) async {
    final prefs = await SharedPreferences.getInstance();
    final health = prefs.getStringList(_healthKey) ?? const <String>[];
    for (final entry in health) {
      final parts = entry.split('|');
      if (parts.length >= 2 && parts[0] == path) {
        return _HealthEntry(path, parts[1], parts.length > 2 ? parts[2] : '');
      }
    }
    return null;
  }

  static Future<void> _setHealth(String path, String status, String reason) async {
    final prefs = await SharedPreferences.getInstance();
    final health = prefs.getStringList(_healthKey) ?? <String>[];
    health.removeWhere((entry) => entry.startsWith('$path|'));
    health.add('$path|$status|$reason');
    await prefs.setStringList(_healthKey, health);
  }

  /// True when [path] crashed the process on two consecutive load attempts
  /// with no successful load in between. Native code must never be handed a
  /// quarantined file again until [clearQuarantine] runs.
  static Future<bool> isQuarantined(String path) async {
    if (path.isEmpty) return false;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.containsKey(_quarantineKey)) {
      // Migrate away the old permanent-on-first-crash key; the new
      // strike-based health entries are the only source of truth below.
      await prefs.remove(_quarantineKey);
    }
    final entry = await _healthFor(path);
    return entry?.status == _healthStatusQuarantined;
  }

  /// Called once at startup. A surviving load marker means the previous run
  /// ended while a native load was in progress. One interruption alone is not
  /// proof of model corruption (the process can die for unrelated reasons),
  /// so the first strike only records `temporarily_failed` and a retry is
  /// still allowed. A second consecutive interruption of the same file
  /// escalates it to `quarantined`. Returns the path a marker was found for,
  /// regardless of which state it lands in — callers should check
  /// [isQuarantined] afterward to know whether a retry is still allowed.
  ///
  /// [exitReason] is Android's own explanation for the previous process
  /// death, when one is available (see ServiceExitInspector). A marker alone
  /// is NOT evidence against the model: the process can die because Android
  /// reclaimed memory, because the app was updated, or because the inference
  /// service crashed for reasons unrelated to these bytes. Escalation to
  /// `quarantined` therefore requires an exit reason that is actually
  /// attributable to the artifact. Without one the file stays
  /// `temporarily_failed` and remains retryable indefinitely.
  static Future<String?> recoverFromNativeCrash({String? exitReason}) async {
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString(_pendingKey);
    if (pending == null || pending.isEmpty) return null;

    final previous = await _healthFor(pending);
    final alreadyFailedOnce = previous?.status == _healthStatusTemporarilyFailed;
    final attributable = isAttributableToModel(exitReason ?? 'NATIVE_LOAD_ABORT');
    final nextStatus = (alreadyFailedOnce && attributable)
        ? _healthStatusQuarantined
        : _healthStatusTemporarilyFailed;
    await _setHealth(
      pending,
      nextStatus,
      attributable ? 'interrupted_load' : (exitReason ?? 'unattributable_exit'),
    );
    await recordFailure(
      path: pending,
      failureClass: exitReason ?? 'NATIVE_LOAD_ABORT',
      operation: 'load',
      attributedToModel: attributable,
    );
    await prefs.remove(_quarantineKey);
    await prefs.remove(_pendingKey);

    Diagnostics.capture(
      feature: nextStatus == _healthStatusQuarantined
          ? 'model.quarantined_after_repeated_crash'
          : 'model.interrupted_load_recovered',
      error: nextStatus == _healthStatusQuarantined
          ? 'Process died loading $pending on two consecutive attempts; it is now quarantined.'
          : 'Previous run ended while loading $pending; marked temporarily_failed pending revalidation.',
      fatalToProcess: true,
    );
    debugPrint('MODEL: recoverFromNativeCrash $pending -> $nextStatus');
    return pending;
  }

  /// Records that a native load is starting. Survives a process kill.
  static Future<void> beginLoad(String path) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_pendingKey, path);
  }

  /// Clears the marker and resets the strike count after a native load
  /// returned control to Dart — proof this file is not what killed the
  /// process last time.
  static Future<void> endLoad(String path) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pendingKey);
    final health = prefs.getStringList(_healthKey);
    if (health == null) return;
    final filtered = health.where((entry) => !entry.startsWith('$path|')).toList();
    if (filtered.length != health.length) {
      await prefs.setStringList(_healthKey, filtered);
    }
  }

  /// Failure classes that are NOT attributable to the model artifact.
  ///
  /// A strike may only be recorded when deterministic evidence connects the
  /// exact artifact to a repeatable native load failure. Everything below is
  /// evidence that something else went wrong — the inference service died,
  /// Android reclaimed memory, the app was updated, the device rebooted, the
  /// user cancelled. Counting any of them as a model strike is what let a
  /// service kill quarantine a perfectly good model after two attempts.
  static const Set<String> nonAttributableFailures = {
    'INFERENCE_SERVICE_DISCONNECTED',
    'INFERENCE_SERVICE_BIND_FAILED',
    'INFERENCE_SERVICE_DIED',
    'INFERENCE_SERVICE_BINDER_DIED',
    'INFERENCE_SERVICE_START_FAILED',
    'INFERENCE_SERVICE_REBIND_EXHAUSTED',
    'INFERENCE_SERVICE_LOW_MEMORY_KILL',
    'INFERENCE_SERVICE_NATIVE_CRASH',
    'INFERENCE_SERVICE_JVM_CRASH',
    'INFERENCE_SERVICE_UNKNOWN_EXIT',
    'APP_TERMINATED',
    'APP_UPDATED',
    'DEVICE_RESTARTED',
    'NETWORK_FAILURE',
    'OPERATION_CANCELLED',
    'STALE_LOAD_MARKER',
  };

  static const String _failureLogKey = 'loki_model_failure_log_v1';

  /// True when [failureClass] may count against the model itself.
  static bool isAttributableToModel(String? failureClass) {
    if (failureClass == null || failureClass.isEmpty) return false;
    return !nonAttributableFailures.contains(failureClass);
  }

  /// Abandons an in-flight load attempt WITHOUT recording a strike.
  ///
  /// Used when the attempt was aborted by something other than the model:
  /// the load marker is cleared so it cannot later be mistaken for an
  /// interrupted native load, but the model's health is left untouched.
  static Future<void> discardLoadAttempt(
    String path, {
    required String reason,
    Map<String, dynamic> evidence = const {},
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pendingKey);
    await recordFailure(
      path: path,
      failureClass: reason,
      operation: 'load',
      evidence: evidence,
      attributedToModel: false,
    );
    debugPrint('MODEL: discarded load attempt for $path (reason=$reason)');
  }

  /// Persists a structured failure record for later diagnosis.
  ///
  /// Kept deliberately separate from the health/strike store: this is
  /// evidence, not a verdict. `attributedToModel` records whether the
  /// evidence was strong enough to blame the artifact.
  static Future<void> recordFailure({
    required String path,
    required String failureClass,
    required String operation,
    Map<String, dynamic> evidence = const {},
    bool attributedToModel = false,
    String adapterVersion = '1',
    String runtimeVersion = 'lokiai_android_runtime_1',
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final log = prefs.getStringList(_failureLogKey) ?? <String>[];
      final exit = evidence['exit_evidence'];
      log.add(jsonEncode({
        'artifact_fingerprint': _fingerprint(path),
        'adapter_version': adapterVersion,
        'runtime_version': runtimeVersion,
        'failure_class': failureClass,
        'exit_reason': exit is Map ? exit['reason_name'] : null,
        'operation': operation,
        'timestamp': DateTime.now().toUtc().toIso8601String(),
        // 'platform_confirmed' means Android itself explained the exit;
        // 'inferred' means we only know the lifecycle callback that fired.
        'evidence_level': exit is Map ? 'platform_confirmed' : 'inferred',
        'attributed_to_model': attributedToModel,
      }));
      // Bounded: keep the most recent 50 records.
      final trimmed = log.length > 50 ? log.sublist(log.length - 50) : log;
      await prefs.setStringList(_failureLogKey, trimmed);
    } catch (e) {
      debugPrint('MODEL: failure record could not be persisted: $e');
    }
  }

  /// The persisted structured failure records, newest last.
  static Future<List<Map<String, dynamic>>> failureLog() async {
    final prefs = await SharedPreferences.getInstance();
    final log = prefs.getStringList(_failureLogKey) ?? const <String>[];
    return log
        .map((e) {
          try {
            final decoded = jsonDecode(e);
            return decoded is Map<String, dynamic> ? decoded : null;
          } catch (_) {
            return null;
          }
        })
        .whereType<Map<String, dynamic>>()
        .toList();
  }

  /// Short, path-free identifier for an artifact, so no private absolute
  /// path is written into the failure log.
  static String _fingerprint(String path) {
    final base = path.split(RegExp(r'[/\\]')).last;
    return sha256.convert(utf8.encode(base)).toString().substring(0, 16);
  }

  /// Lets a user retry a model they believe is now fine (e.g. re-downloaded).
  /// Clears every tracked file's health when [path] is omitted.
  static Future<void> clearQuarantine([String? path]) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_quarantineKey);
    await prefs.remove(_pendingKey);
    if (path == null) {
      await prefs.remove(_healthKey);
      return;
    }
    final health = prefs.getStringList(_healthKey);
    if (health == null) return;
    final filtered = health.where((entry) => !entry.startsWith('$path|')).toList();
    if (filtered.length != health.length) {
      await prefs.setStringList(_healthKey, filtered);
    }
  }
}

class _HealthEntry {
  final String path;
  final String status;
  final String reason;
  const _HealthEntry(this.path, this.status, this.reason);
}
