// Smoke test for the LokiAI app shell.
//
// This file previously contained the unmodified Flutter "counter" scaffold
// test, which referenced a `MyApp` class that has never existed in this
// project — the root widget is `LokiApp`. It therefore failed to compile and
// broke `flutter test` for the entire package, masking every other test.
// Replaced with a test that builds the real root widget.

import 'package:flutter_test/flutter_test.dart';

import 'package:lokiai_app/main.dart';

void main() {
  testWidgets('LokiApp builds its first frame without throwing',
      (WidgetTester tester) async {
    await tester.pumpWidget(const LokiApp());

    // Only one frame is pumped deliberately. PairingGate resolves
    // asynchronously against SharedPreferences, and pumpAndSettle() would time
    // out waiting for a platform channel that no plain unit-test binding
    // answers. The first frame is enough to catch a build-time regression in
    // the widget tree.
    await tester.pump();

    expect(tester.takeException(), isNull);
  });
}
