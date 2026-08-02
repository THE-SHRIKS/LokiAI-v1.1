import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const String kConfigPath = '/sdcard/edgemind/config.json';
const String kModelsDir  = '/sdcard/edgemind/models/';

/// Parsed representation of /sdcard/edgemind/config.json
class AppConfig {
  final String modelName;
  final String modelPath;
  final String inferenceMode; // "camera" | "chat" | "voice"
  final String format;        // "tflite" | "gguf"
  final double confidenceThreshold;
  final String deploymentId;
  // Written by the v3 wireless downloader; 0/empty for legacy v2 configs.
  final int modelSizeBytes;
  final String modelSha256;
  
  // Added fields for dual model support
  final String? llmModel;
  final String? llmPath;

  const AppConfig({
    required this.modelName,
    required this.modelPath,
    required this.inferenceMode,
    required this.format,
    this.confidenceThreshold = 0.5,
    this.deploymentId = '',
    this.modelSizeBytes = 0,
    this.modelSha256 = '',
    this.llmModel,
    this.llmPath,
  });

  factory AppConfig.fromJson(Map<String, dynamic> j) {
    final name = j['model_name'] as String? ?? '';
    return AppConfig(
      modelName:           name,
      modelPath:           j['model_path'] as String? ?? '$kModelsDir$name',
      inferenceMode:       j['inference_mode'] as String? ?? 'chat',
      format:              j['format'] as String? ?? 'tflite',
      confidenceThreshold: (j['confidence_threshold'] as num?)?.toDouble() ?? 0.55,
      deploymentId:        j['deployment_id'] as String? ?? '',
      modelSizeBytes:      (j['model_size_bytes'] as num?)?.toInt() ?? 0,
      modelSha256:         j['model_sha256'] as String? ?? '',
      llmModel:            j['llm_model'] as String?,
      llmPath:             j['llm_path'] as String?,
    );
  }

  String get displayMode {
    switch (inferenceMode) {
      case 'camera': return 'Vision';
      case 'voice':  return 'Voice';
      case 'chat':   return 'Chat';
      default:       return inferenceMode;
    }
  }

  String get displayLabel {
    if (inferenceMode == 'chat' && llmModel != null && llmModel!.isNotEmpty) {
      return '$displayMode — $llmModel';
    }
    return '$displayMode — $modelName';
  }

  Map<String, dynamic> toJson() => {
        'model_name': modelName,
        'model_path': modelPath,
        'inference_mode': inferenceMode,
        'format': format,
        'confidence_threshold': confidenceThreshold,
        'deployment_id': deploymentId,
        'model_size_bytes': modelSizeBytes,
        'model_sha256': modelSha256,
        if (llmModel != null) 'llm_model': llmModel,
        if (llmPath != null) 'llm_path': llmPath,
      };
}

/// Result returned by ConfigReader.load()
class ConfigResult {
  final AppConfig? config;
  final String? error; // null = success

  const ConfigResult({this.config, this.error});

  bool get hasConfig => config != null;
}

/// Reads and parses config.json.
/// v3: internal app storage first (written by the wireless deployment
/// pipeline), then the legacy /sdcard/edgemind path as fallback.
/// Does NOT request permissions — caller must do that first.
class ConfigReader {
  static Future<List<AppConfig>> loadInstalled() async {
    try {
      final docs = await getApplicationDocumentsDirectory();
      final registry = File('${docs.path}/model-registry.json');
      if (!await registry.exists()) {
        final active = await load();
        return active.config == null ? [] : [active.config!];
      }
      final decoded = jsonDecode(await registry.readAsString());
      if (decoded is! List) return [];
      final installed = <AppConfig>[];
      for (final item in decoded) {
        if (item is! Map) continue;
        final config = AppConfig.fromJson(Map<String, dynamic>.from(item));
        if (config.modelPath.isNotEmpty && await File(config.modelPath).exists()) {
          installed.add(config);
        }
      }
      return installed;
    } catch (e) {
      print('VERIFICATION: config_reader -> installed models error: $e');
      return [];
    }
  }

  static Future<void> activate(AppConfig config) async {
    final docs = await getApplicationDocumentsDirectory();
    await File('${docs.path}/config.json').writeAsString(jsonEncode(config.toJson()));
  }

  static Future<ConfigResult> load() async {
    // v3 wireless deployments write to internal app storage.
    try {
      final docs = await getApplicationDocumentsDirectory();
      final internal = File('${docs.path}/config.json');
      if (await internal.exists()) {
        return _parse(internal, defaultModelsDir: '${docs.path}/models/');
      }
    } catch (e) {
      print('VERIFICATION: config_reader -> internal storage error: $e');
    }

    // Legacy v2 location.
    final legacy = File(kConfigPath);
    if (!await legacy.exists()) {
      print('VERIFICATION: config_reader -> no_model (config.json not found)');
      return const ConfigResult(error: 'no_model');
    }
    return _parse(legacy, defaultModelsDir: kModelsDir);
  }

  static Future<ConfigResult> _parse(File configFile,
      {required String defaultModelsDir}) async {
    try {
      final raw    = await configFile.readAsString();
      final json   = jsonDecode(raw) as Map<String, dynamic>;
      final config = AppConfig.fromJson(json);

      // Verify model file exists
      final modelFile = File(config.modelPath.isNotEmpty
          ? config.modelPath
          : '$defaultModelsDir${config.modelName}');

      if (!await modelFile.exists()) {
        final msg = 'model_not_found: ${config.modelName}';
        print('VERIFICATION: config_reader -> $msg');
        return ConfigResult(error: msg);
      }

      // Corruption guard: a model whose on-disk size differs from what the
      // downloader recorded would crash the native inference runtimes.
      // Refuse to load it and surface a clean error instead.
      if (config.modelSizeBytes > 0) {
        final actualSize = await modelFile.length();
        if (actualSize != config.modelSizeBytes) {
          final msg = 'model_corrupt: ${config.modelName} '
              '($actualSize of ${config.modelSizeBytes} bytes). '
              'Re-deploy the model from the dashboard.';
          print('VERIFICATION: config_reader -> $msg');
          return ConfigResult(error: msg);
        }
      }

      print('VERIFICATION: config_reader -> mode=${config.inferenceMode} model=${config.modelName}');
      return ConfigResult(config: config);
    } catch (e) {
      print('VERIFICATION: config_reader -> parse_error: $e');
      return ConfigResult(error: 'parse_error: $e');
    }
  }
}
