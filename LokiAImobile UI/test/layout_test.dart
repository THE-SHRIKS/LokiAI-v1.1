import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/widgets/model_selector_pill.dart';

/// A realistically hostile identifier: HuggingFace repo ids are unbounded and
/// the deployed screenshot showed exactly this class of value escaping its pill.
const String _longModelName =
    'Chat - unsloth/Qwen2.5-Coder-1.5B-Instruct-128K-GGUF-Q4_K_M-imatrix-v2';

/// MaterialApp supplies the Overlay that Tooltip needs, exactly as the real
/// widget tree does.
Widget _harness(Widget child, {double width = 320}) {
  return MaterialApp(
    home: Scaffold(
      body: Center(
        child: SizedBox(
          width: width,
          // Mirrors the real call site: a Row that bounds the pill.
          child: Row(children: [Flexible(child: child)]),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('a very long model name does not overflow a 320px screen',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      _harness(ModelSelectorPill(label: _longModelName, onTap: () {})),
    );

    // A RenderFlex overflow is reported as a framework exception; the old
    // unconstrained Text produced one here.
    expect(tester.takeException(), isNull);

    final pill = tester.getSize(find.byType(ModelSelectorPill));
    expect(pill.width, lessThanOrEqualTo(320));
  });

  testWidgets('the long name is ellipsised on a single line, not shrunk',
      (tester) async {
    await tester.pumpWidget(
      _harness(ModelSelectorPill(label: _longModelName, onTap: () {})),
    );

    final text = tester.widget<Text>(find.text(_longModelName));
    expect(text.maxLines, 1);
    expect(text.overflow, TextOverflow.ellipsis);
    // Readability is preserved: the fix is layout, not a smaller font.
    expect(text.style?.fontSize, 13);
  });

  testWidgets('the complete value stays available in a tooltip',
      (tester) async {
    await tester.pumpWidget(
      _harness(ModelSelectorPill(label: _longModelName, onTap: () {})),
    );

    final tooltip = tester.widget<Tooltip>(find.byType(Tooltip));
    expect(tooltip.message, _longModelName);
  });

  testWidgets('a short model name is not padded out to the full width',
      (tester) async {
    await tester.pumpWidget(
      _harness(const ModelSelectorPill(label: 'No model', onTap: _noop)),
    );

    final pill = tester.getSize(find.byType(ModelSelectorPill));
    expect(pill.width, lessThan(200));
    expect(pill.height, 36);
  });

  testWidgets('the pill still fits when the keyboard shrinks the viewport',
      (tester) async {
    // 260 logical pixels is narrower than any shipping Android phone; if it
    // holds here it holds with a keyboard-reduced layout on a small device.
    tester.view.physicalSize = const Size(260, 400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      _harness(
        ModelSelectorPill(label: _longModelName, onTap: () {}),
        width: 260,
      ),
    );

    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.byType(ModelSelectorPill)).width,
        lessThanOrEqualTo(260));
  });

  testWidgets('tapping the pill invokes the picker callback', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      _harness(ModelSelectorPill(label: 'Chat - qwen', onTap: () => taps++)),
    );

    await tester.tap(find.byType(ModelSelectorPill));
    expect(taps, 1);
  });
}

void _noop() {}
