import 'dart:io';
import 'dart:typed_data';

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
///     launch quarantines that exact file instead of loading it again. A bad
///     model can therefore take the app down at most once, and can never make
///     it impossible to reopen.
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

  /// True when [path] previously killed the process during a native load.
  static Future<bool> isQuarantined(String path) async {
    final prefs = await SharedPreferences.getInstance();
    return (prefs.getStringList(_quarantineKey) ?? const []).contains(path);
  }

  /// Called once at startup. If a load marker survived, the process died
  /// inside native code loading that file, so it is quarantined permanently.
  /// Returns the quarantined path when a crash was detected.
  static Future<String?> recoverFromNativeCrash() async {
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString(_pendingKey);
    if (pending == null || pending.isEmpty) return null;

    final quarantined = prefs.getStringList(_quarantineKey) ?? <String>[];
    if (!quarantined.contains(pending)) {
      quarantined.add(pending);
      await prefs.setStringList(_quarantineKey, quarantined);
    }
    await prefs.remove(_pendingKey);

    Diagnostics.capture(
      feature: 'model.native_crash_recovered',
      error: 'Process died loading $pending; it is now quarantined.',
      fatalToProcess: true,
    );
    debugPrint('MODEL: quarantined after native crash: $pending');
    return pending;
  }

  /// Records that a native load is starting. Survives a process kill.
  static Future<void> beginLoad(String path) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_pendingKey, path);
  }

  /// Clears the marker after the native load returned control to Dart.
  static Future<void> endLoad() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pendingKey);
  }

  /// Lets a user retry a model they believe is now fine (e.g. re-downloaded).
  static Future<void> clearQuarantine() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_quarantineKey);
    await prefs.remove(_pendingKey);
  }
}
