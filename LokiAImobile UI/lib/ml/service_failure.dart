import 'dart:convert';

import 'package:flutter/services.dart';

/// Classification of on-device inference-SERVICE failures, kept strictly
/// separate from model-artifact failures.
///
/// Before this existed, `PlatformException(SERVICE_DISCONNECTED, ...)` from
/// the isolated `:inference` process was caught by a generic handler in
/// `chat_inference.dart` and reported as `CHAT_CONTEXT_CREATE_FAILED` with
/// "redeploy this one from the dashboard" — telling the user their model was
/// broken when Android had simply killed the service process. Redeploying
/// identical bytes cannot fix a service that ran out of memory.
///
/// Every code here describes the SERVICE. None may be mapped onto a model
/// failure code, and none may trigger a redeploy suggestion or a ModelGuard
/// strike.
class ServiceFailure {
  /// Codes emitted by FllamaPlugin.kt. Keep in sync with
  /// `ServiceFailureCode` in ServiceDiagnostics.kt and with
  /// `INFERENCE_SERVICE_FAILURE_CODES` in the backend's main.py.
  static const Set<String> codes = {
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
  };

  /// Legacy codes from an older installed APK talking to a newer Dart layer.
  /// Mapped forward so a mixed-version device still classifies correctly.
  static const Map<String, String> _legacy = {
    'SERVICE_DISCONNECTED': 'INFERENCE_SERVICE_DISCONNECTED',
    'SERVICE_DIED': 'INFERENCE_SERVICE_DIED',
    'SERVICE_BIND_FAILED': 'INFERENCE_SERVICE_BIND_FAILED',
    'SERVICE_SEND_FAILED': 'INFERENCE_SERVICE_BINDER_DIED',
    'SERVICE_NOT_READY': 'INFERENCE_SERVICE_START_FAILED',
    'PLUGIN_DETACHED': 'INFERENCE_SERVICE_DISCONNECTED',
  };

  final String code;
  final String message;
  final Map<String, dynamic> details;

  const ServiceFailure(this.code, this.message, this.details);

  /// Returns a [ServiceFailure] when [error] is a service fault, else null.
  /// A null result means the caller may treat the error as model-related.
  static ServiceFailure? from(Object? error) {
    if (error is! PlatformException) return null;
    final raw = error.code;
    final normalized = codes.contains(raw) ? raw : _legacy[raw];
    if (normalized == null) return null;
    return ServiceFailure(
      normalized,
      error.message ?? 'The on-device inference service failed.',
      _decodeDetails(error.details),
    );
  }

  static bool isServiceFailure(Object? error) => from(error) != null;

  static Map<String, dynamic> _decodeDetails(Object? details) {
    if (details is Map) {
      return details.map((k, v) => MapEntry(k.toString(), v));
    }
    if (details is String && details.isNotEmpty) {
      try {
        final decoded = jsonDecode(details);
        if (decoded is Map) {
          return decoded.map((k, v) => MapEntry(k.toString(), v));
        }
      } catch (_) {
        // Not JSON — surface it verbatim rather than dropping it.
        return {'raw': details};
      }
    }
    return const {};
  }

  /// Android's own exit classification, when it supplied one.
  String? get exitReasonName =>
      (details['exit_evidence'] as Map?)?['reason_name'] as String?;

  /// True only when Android explicitly attributed the exit to memory
  /// pressure. Never inferred from a bare disconnect.
  bool get isConfirmedMemoryKill => code == 'INFERENCE_SERVICE_LOW_MEMORY_KILL';

  /// Whether the cause is genuinely unexplained by the platform.
  bool get isUnexplained => code == 'INFERENCE_SERVICE_UNKNOWN_EXIT';

  /// Whether recovery is even possible. Exhausted rebinding is terminal for
  /// this app session and must not be retried in a loop.
  bool get isRecoverable => code != 'INFERENCE_SERVICE_REBIND_EXHAUSTED';

  /// User-facing text. Describes the service, never the model, and never
  /// suggests redeploying — the bytes on disk are not the problem.
  String get userMessage {
    switch (code) {
      case 'INFERENCE_SERVICE_LOW_MEMORY_KILL':
        return 'Android stopped LokiAI\'s inference service to free up memory. '
            'Your model is fine. Close some other apps and try again.';
      case 'INFERENCE_SERVICE_REBIND_EXHAUSTED':
        return 'LokiAI could not restart its inference service after several '
            'attempts. Restart the app to recover. Your deployed models are '
            'unaffected.';
      case 'INFERENCE_SERVICE_NATIVE_CRASH':
        return 'LokiAI\'s inference service stopped due to a native crash. '
            'This is a service fault and has been recorded for diagnosis.';
      case 'INFERENCE_SERVICE_JVM_CRASH':
        return 'LokiAI\'s inference service stopped unexpectedly. This is a '
            'service fault and has been recorded for diagnosis.';
      case 'INFERENCE_SERVICE_BIND_FAILED':
      case 'INFERENCE_SERVICE_START_FAILED':
        return 'LokiAI could not start its inference service on this device. '
            'Try again, or restart the app if it keeps happening.';
      case 'INFERENCE_SERVICE_UNKNOWN_EXIT':
        return 'LokiAI\'s inference service stopped for a reason this version '
            'of Android does not report. Try again — your model is unchanged.';
      default:
        return 'LokiAI\'s inference service disconnected. This is a service '
            'fault, not a problem with your model. Try again.';
    }
  }

  /// Telemetry payload for the existing runtime_event protocol.
  Map<String, dynamic> toRuntimeEvent({
    required String operation,
    String? deploymentId,
    String? modelId,
  }) {
    return <String, dynamic>{
      'type': 'runtime_event',
      'schema_version': 1,
      'event_type': 'inference_service_failure',
      'operation': operation,
      'deployment_id': deploymentId,
      'model_id': modelId,
      'success': false,
      'error_code': code,
      'error_detail': message,
      'service_diagnostics': details,
      'occurred_at': DateTime.now().toUtc().toIso8601String(),
    };
  }

  @override
  String toString() => 'ServiceFailure($code)';
}
