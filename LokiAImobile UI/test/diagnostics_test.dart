import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/diagnostics.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(Diagnostics.resetForTest);

  test('capture records the full context section 7 requires', () {
    Diagnostics.appVersion = '1.0.6';
    Diagnostics.buildNumber = '7';

    final record = Diagnostics.capture(
      feature: 'camera.initialize',
      error: StateError('camera in use'),
      stackTrace: StackTrace.current,
    );

    expect(record.feature, 'camera.initialize');
    expect(record.exceptionType, 'StateError');
    expect(record.message, contains('camera in use'));
    expect(record.stackTrace, isNotNull);
    expect(record.appVersion, '1.0.6');
    expect(record.buildNumber, '7');
    expect(record.platform, isNotEmpty);
    expect(record.lifecycleState, isNotEmpty);
    expect(record.correlationId, hasLength(12));
    expect(Diagnostics.recent, hasLength(1));
  });

  test('correlation ids are distinct', () {
    final ids = List.generate(200, (_) => Diagnostics.newCorrelationId());
    expect(ids.toSet().length, greaterThan(190));
  });

  test('guard converts a throwing body into a captured record', () async {
    CrashRecord? seen;
    final result = await Diagnostics.guard<int>(
      'chat.send',
      () async => throw const FormatException('bad json'),
      onError: (record) => seen = record,
    );

    expect(result, isNull);
    expect(seen, isNotNull);
    expect(seen!.feature, 'chat.send');
    expect(seen!.exceptionType, 'FormatException');
    expect(Diagnostics.recent, hasLength(1));
  });

  test('guard returns the value when the body succeeds', () async {
    final result = await Diagnostics.guard<int>('chat.send', () async => 42);
    expect(result, 42);
    expect(Diagnostics.recent, isEmpty);
  });

  test('the recent buffer is bounded', () {
    for (var i = 0; i < 120; i++) {
      Diagnostics.capture(feature: 'test', error: 'error $i');
    }
    expect(Diagnostics.recent, hasLength(50));
    // Oldest are dropped, newest retained.
    expect(Diagnostics.recent.last.message, contains('error 119'));
  });

  test('the log line carries no user content beyond the exception', () {
    final record = Diagnostics.capture(
      feature: 'camera.capture',
      error: Exception('write failed'),
    );
    final line = record.toLogLine();
    expect(line, contains('corr=${record.correlationId}'));
    expect(line, contains('feature=camera.capture'));
    expect(line, isNot(contains('password')));
    expect(line, isNot(contains('token')));
  });
}
