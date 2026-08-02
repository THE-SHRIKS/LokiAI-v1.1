import 'package:flutter/material.dart';

import '../main.dart' show LokiColors;

/// The "current model" control above the chat input.
///
/// Model identifiers are arbitrarily long HuggingFace repository paths
/// ("unsloth/Qwen2.5-Coder-1.5B-Instruct-128K-GGUF"). The label used to be an
/// unconstrained `Text` inside a `MainAxisSize.min` `Row`, so a long name grew
/// the pill straight past the screen edge and produced a RenderFlex overflow
/// stripe on small Android screens.
///
/// The fix is layout-level, not typographic: the caller gives this widget a
/// bounded width (`Flexible`), the label is `Flexible` inside the pill, capped
/// at one line, and ellipsised. Text size is unchanged — the complete value
/// stays reachable through the tooltip and the picker sheet.
class ModelSelectorPill extends StatelessWidget {
  const ModelSelectorPill({
    super.key,
    required this.label,
    required this.onTap,
  });

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: LokiColors.surface1,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: LokiColors.dividerGray, width: 1),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: LokiColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.keyboard_arrow_down,
                size: 16,
                color: LokiColors.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
