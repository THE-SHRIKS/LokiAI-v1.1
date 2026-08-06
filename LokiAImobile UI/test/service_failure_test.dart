import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/ml/model_guard.dart';
import 'package:lokiai_app/ml/service_failure.dart';

/// Regression tests for the P0 incident's second failure: a fault in the
/// isolated `:inference` service being reported to the user as a model
/// incompatibility, with advice to redeploy bytes that were never at fault.
void main() {
  PlatformException disconnect({Object? details}) => PlatformException(
        code: 'INFERENCE_SERVICE_DISCONNECTED',
        message: 'The on-device inference service disconnected.',
        details: details,
      );

  group('12: service failures are not model failures', () {
    test('SERVICE_DISCONNECTED classifies as a service failure', () {
      final failure = ServiceFailure.from(disconnect());
      expect(failure, isNotNull);
      expect(failure!.code, 'INFERENCE_SERVICE_DISCONNECTED');
    });

    test('a model failure code is NOT treated as a service failure', () {
      final failure = ServiceFailure.from(
        PlatformException(code: 'CHAT_CONTEXT_CREATE_FAILED'),
      );
      expect(failure, isNull);
    });

    test('legacy SERVICE_DISCONNECTED from an older APK maps forward', () {
      // A phone running the previous build still emits the old code.
      final failure = ServiceFailure.from(
        PlatformException(code: 'SERVICE_DISCONNECTED'),
      );
      expect(failure, isNotNull);
      expect(failure!.code, 'INFERENCE_SERVICE_DISCONNECTED');
    });

    test('no service message ever suggests redeploying the model', () {
      for (final code in ServiceFailure.codes) {
        final failure = ServiceFailure(code, 'msg', const {});
        expect(
          failure.userMessage.toLowerCase(),
          isNot(contains('redeploy')),
          reason: '$code must not advise redeployment',
        );
      }
    });

    test('non-PlatformException errors are not service failures', () {
      expect(ServiceFailure.from(Exception('boom')), isNull);
      expect(ServiceFailure.from(null), isNull);
    });
  });

  group('13: service death is not a model strike', () {
    test('every service code is non-attributable to the model', () {
      for (final code in ServiceFailure.codes) {
        expect(
          ModelGuard.isAttributableToModel(code),
          isFalse,
          reason: '$code must never count against the model',
        );
      }
    });

    test('non-service interruptions are also non-attributable', () {
      for (final code in const [
        'APP_TERMINATED', 'APP_UPDATED', 'DEVICE_RESTARTED',
        'NETWORK_FAILURE', 'OPERATION_CANCELLED', 'STALE_LOAD_MARKER',
      ]) {
        expect(ModelGuard.isAttributableToModel(code), isFalse, reason: code);
      }
    });

    test('a genuine native load abort IS attributable', () {
      expect(ModelGuard.isAttributableToModel('NATIVE_LOAD_ABORT'), isTrue);
    });

    test('an unknown/empty class is not attributable', () {
      expect(ModelGuard.isAttributableToModel(null), isFalse);
      expect(ModelGuard.isAttributableToModel(''), isFalse);
    });
  });

  group('14: service failures carry structured details', () {
    test('JSON details from the plugin are decoded', () {
      final details = jsonEncode({
        'component_name': 'io.lokiai/.FllamaService',
        'service_state': 'disconnected',
        'binding_completed': true,
        'request_active': true,
        'active_operation': 'load',
        'active_request_id': 7,
        'model_fingerprint': 'a1b2c3d4',
        'rebind_attempts': 2,
        'session_generation': 3,
        'exit_evidence': {
          'classified_code': 'INFERENCE_SERVICE_LOW_MEMORY_KILL',
          'reason_name': 'LOW_MEMORY',
          'pss_kb': 1048576,
        },
      });
      final failure = ServiceFailure.from(disconnect(details: details));
      expect(failure, isNotNull);
      expect(failure!.details['service_state'], 'disconnected');
      expect(failure.details['rebind_attempts'], 2);
      expect(failure.details['active_operation'], 'load');
      expect(failure.exitReasonName, 'LOW_MEMORY');
    });

    test('a null details field no longer loses all diagnostics silently', () {
      // Null still yields an empty map rather than throwing, but the code
      // itself is now classified rather than opaque.
      final failure = ServiceFailure.from(disconnect(details: null));
      expect(failure, isNotNull);
      expect(failure!.details, isEmpty);
      expect(failure.code, 'INFERENCE_SERVICE_DISCONNECTED');
    });

    test('non-JSON details are preserved verbatim, not dropped', () {
      final failure = ServiceFailure.from(disconnect(details: 'raw text'));
      expect(failure!.details['raw'], 'raw text');
    });

    test('no absolute filesystem path appears in details', () {
      final details = jsonEncode({'model_fingerprint': 'a1b2c3d4'});
      final failure = ServiceFailure.from(disconnect(details: details));
      final encoded = jsonEncode(failure!.details);
      expect(encoded, isNot(contains('/data/user/')));
      expect(encoded, isNot(contains('/storage/')));
    });
  });

  group('18: unknown exit stays unknown', () {
    test('an unexplained exit is not reported as a memory kill', () {
      const failure = ServiceFailure(
        'INFERENCE_SERVICE_UNKNOWN_EXIT', 'msg', {},
      );
      expect(failure.isConfirmedMemoryKill, isFalse);
      expect(failure.isUnexplained, isTrue);
      expect(failure.userMessage.toLowerCase(), isNot(contains('memory')));
    });

    test('only an explicit low-memory classification claims memory', () {
      const failure = ServiceFailure(
        'INFERENCE_SERVICE_LOW_MEMORY_KILL', 'msg', {},
      );
      expect(failure.isConfirmedMemoryKill, isTrue);
      expect(failure.userMessage.toLowerCase(), contains('memory'));
      // Even here the model is explicitly exonerated.
      expect(failure.userMessage.toLowerCase(), contains('model is fine'));
    });

    test('a bare disconnect does not claim memory pressure', () {
      const failure = ServiceFailure(
        'INFERENCE_SERVICE_DISCONNECTED', 'msg', {},
      );
      expect(failure.isConfirmedMemoryKill, isFalse);
      expect(failure.userMessage.toLowerCase(), isNot(contains('memory')));
    });
  });

  group('15: rebind exhaustion is terminal, not a loop', () {
    test('exhausted rebinding is marked unrecoverable', () {
      const failure = ServiceFailure(
        'INFERENCE_SERVICE_REBIND_EXHAUSTED', 'msg', {},
      );
      expect(failure.isRecoverable, isFalse);
      expect(failure.userMessage.toLowerCase(), contains('restart the app'));
    });

    test('an ordinary disconnect remains recoverable', () {
      const failure = ServiceFailure(
        'INFERENCE_SERVICE_DISCONNECTED', 'msg', {},
      );
      expect(failure.isRecoverable, isTrue);
    });
  });

  group('telemetry', () {
    test('runtime event carries the service code and diagnostics', () {
      final failure = ServiceFailure.from(
        disconnect(details: jsonEncode({'service_state': 'dead'})),
      )!;
      final event = failure.toRuntimeEvent(
        operation: 'load', deploymentId: 'dep-1', modelId: 'model-1',
      );
      expect(event['event_type'], 'inference_service_failure');
      expect(event['error_code'], 'INFERENCE_SERVICE_DISCONNECTED');
      expect(event['success'], isFalse);
      expect((event['service_diagnostics'] as Map)['service_state'], 'dead');
    });
  });
}
