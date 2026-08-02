import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Application-level crash containment and structured diagnostics.
///
/// The Android release was terminating the process on ordinary, recoverable
/// feature errors (a camera plugin exception, a native model load failure)
/// because nothing installed a top-level error boundary: `FlutterError.onError`
/// defaulted to `presentError`, and any exception escaping an unawaited future
/// or a platform-channel callback reached the zone's default handler, which
/// Android treats as a fatal uncaught exception.
///
/// This does NOT hide errors — every capture is logged in full with the context
/// section 7 requires. It only stops a recoverable feature failure from killing
/// the process and leaving the app unable to reopen.
class Diagnostics {
  Diagnostics._();

  /// Populated once from the running package. Kept nullable so a failure to
  /// read package metadata can never itself break error reporting.
  static String appVersion = 'unknown';
  static String buildNumber = 'unknown';
  static String androidVersion = 'unknown';

  static final List<CrashRecord> _recent = <CrashRecord>[];
  static const int _maxRecent = 50;

  /// The last 50 captured errors, newest last. Surfaced in-app so a user can
  /// report a failure without a cable, and asserted on by tests.
  static List<CrashRecord> get recent => List.unmodifiable(_recent);

  static final Random _random = Random();

  /// Short, non-sensitive request/interaction identifier. The same value is
  /// attached to every log line for one user interaction so a failure can be
  /// traced across the Flutter, backend, and provider layers.
  static String newCorrelationId() {
    const alphabet = '0123456789abcdef';
    return List.generate(12, (_) => alphabet[_random.nextInt(16)]).join();
  }

  /// Installs the three error boundaries Android can terminate on. Must run
  /// inside the same zone as `runApp` — see `main()`.
  static void install() {
    final previousFlutterHandler = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      capture(
        feature: details.library ?? 'flutter',
        error: details.exception,
        stackTrace: details.stack,
        fatalToProcess: false,
      );
      // Keep the framework's own reporting in debug so nothing is lost during
      // development; in release the structured record above is the record.
      if (kDebugMode && previousFlutterHandler != null) {
        previousFlutterHandler(details);
      }
    };

    // Errors from platform-channel callbacks and other engine-side dispatches
    // do not pass through FlutterError.onError.
    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      capture(
        feature: 'platform_dispatcher',
        error: error,
        stackTrace: stack,
        fatalToProcess: false,
      );
      return true; // handled — do not escalate to a fatal Android crash
    };
  }

  /// Records one error with the full context required by section 7.
  ///
  /// Deliberately records no user images, audio, message text, tokens, or
  /// account identifiers — only the failing subsystem and the technical fault.
  static CrashRecord capture({
    required String feature,
    required Object error,
    StackTrace? stackTrace,
    String? correlationId,
    bool fatalToProcess = false,
  }) {
    final record = CrashRecord(
      correlationId: correlationId ?? newCorrelationId(),
      feature: feature,
      exceptionType: error.runtimeType.toString(),
      message: error.toString(),
      stackTrace: stackTrace?.toString(),
      appVersion: appVersion,
      buildNumber: buildNumber,
      platform: defaultTargetPlatform.name,
      androidVersion: androidVersion,
      lifecycleState:
          WidgetsBinding.instance.lifecycleState?.name ?? 'unknown',
      at: DateTime.now().toUtc(),
      fatalToProcess: fatalToProcess,
    );

    _recent.add(record);
    if (_recent.length > _maxRecent) {
      _recent.removeAt(0);
    }
    debugPrint(record.toLogLine());
    return record;
  }

  /// Runs [body] and converts any failure into a captured record plus [onError],
  /// so a feature can fail without an unhandled exception reaching Android.
  static Future<T?> guard<T>(
    String feature,
    Future<T> Function() body, {
    String? correlationId,
    void Function(CrashRecord record)? onError,
  }) async {
    try {
      return await body();
    } catch (error, stackTrace) {
      final record = capture(
        feature: feature,
        error: error,
        stackTrace: stackTrace,
        correlationId: correlationId,
      );
      onError?.call(record);
      return null;
    }
  }

  @visibleForTesting
  static void resetForTest() => _recent.clear();
}

/// One captured error. Field set is fixed by section 7 of the repair plan.
@immutable
class CrashRecord {
  final String correlationId;
  final String feature;
  final String exceptionType;
  final String message;
  final String? stackTrace;
  final String appVersion;
  final String buildNumber;
  final String platform;
  final String androidVersion;
  final String lifecycleState;
  final DateTime at;
  final bool fatalToProcess;

  const CrashRecord({
    required this.correlationId,
    required this.feature,
    required this.exceptionType,
    required this.message,
    required this.stackTrace,
    required this.appVersion,
    required this.buildNumber,
    required this.platform,
    required this.androidVersion,
    required this.lifecycleState,
    required this.at,
    required this.fatalToProcess,
  });

  String toLogLine() =>
      'LOKI_ERROR corr=$correlationId feature=$feature type=$exceptionType '
      'app=$appVersion+$buildNumber platform=$platform os=$androidVersion '
      'lifecycle=$lifecycleState fatal=$fatalToProcess\n'
      '  message: $message'
      '${stackTrace == null ? '' : '\n  stack: $stackTrace'}';
}
