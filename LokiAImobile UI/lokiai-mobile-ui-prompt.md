# LokiAI Mobile App — UI Build Prompt

## Role & Intent
Design and build the Flutter mobile UI for **LokiAI**, an on-device multi-modal AI assistant (vision + chat + voice). Approach this with the discipline of an Apple Human Interface Guidelines designer: restraint over decoration, hierarchy through spacing and weight (not color), and every element earning its place. This is a **monochrome, performance-first** interface — it must render smoothly on low-tier Android devices, so avoid heavy blur, shadows, gradients, or animated chrome by default.

## Tech Context (for component decisions, not just visuals)
- Flutter (Dart), Gradle/Android build, Kotlin + JVM 17
- On-device inference: `tflite_flutter` (camera/vision), `llama_cpp_dart` via FFI (chat), TFLite Audio planned for voice
- `camera` plugin (CameraX) for camera access, `record` plugin for mic, `permission_handler` for permissions
- All AI runs on-device — no network calls for inference. UI must communicate "local/offline-capable" state implicitly (e.g., no spinners implying server roundtrips; use deterministic local processing indicators instead)

## Color System
- **Base:** True grayscale only. Background near-black (#0A0A0A or similar), surfaces one or two steps lighter (#141414, #1C1C1C) for elevation, text white/off-white (#F5F5F5) for primary, mid-gray (#8A8A8A) for secondary/meta text, low-gray (#3A3A3A) for dividers/borders.
- **One functional accent only:** a single accent color (e.g. a muted red or signal color — your call, but only one) reserved exclusively for live/active states: mic recording in progress, camera actively capturing, a model actively generating a response. Never use the accent decoratively. If nothing is "live," the screen should be entirely grayscale.
- No drop shadows for depth — use 1px hairline borders (low-gray) and subtle surface-tone steps instead. This keeps GPU/compositing cost low on weak hardware.

## Typography
- System font (SF Pro on iOS rendering equivalent / Roboto fallback on Android) — no custom font loading, keep bundle and render cost low.
- Clear scale: Title (17–20pt, semibold), Body (15pt, regular), Caption/meta (12–13pt, medium, secondary gray).
- Generous line-height for chat bubbles; tight line-height for labels/buttons.

## Screen Structure (3 fixed zones, per attached wireframe)

### 1. Top Bar — Camera & Mic Controls
- Fixed height, pinned to top, persists across scroll.
- Two icon-buttons: camera toggle, mic toggle. Outline-style icons, no fill unless active.
- Active state = outline fills solid white + tiny accent-colored dot/ring to indicate "live."
- Tapping camera opens an inline camera preview (not a full navigation push) — collapsible back to icon-only state to preserve vertical space for chat.
- Include a minimal permission-state affordance: if permission not granted, icon shows a subtle dashed/disabled style instead of a popup-first approach — tapping triggers the system permission prompt via `permission_handler`.

### 2. Center — AI Chat Interface
- Scrollable message list, occupies all remaining vertical space.
- User messages: right-aligned, filled surface-gray bubble, white text.
- AI messages: left-aligned, no bubble fill (or near-transparent outline only) — text sits directly on background, like Apple's iMessage-meets-minimal pattern. This reduces overdraw on low-end GPUs.
- Streaming token-by-token text rendering for AI responses (matches local llama.cpp generation) — no shimmer/skeleton loaders, just a small static "thinking" indicator (three static dots or a single pulsing accent dot, not a spinner) before first token.
- Camera preview, when active, appears as a small inline card at the top of the chat thread (not floating/overlay) so vision input feels part of the conversation, per your wireframe note.
- Empty state (no messages yet): centered, minimal — app wordmark/icon in white, one-line subdued instruction text below.

### 3. Bottom — Two-Row Input Bar
**Row 1 (Selector Row, sits above input row, compact height ~36–40px):**
- Horizontally scrollable model-selector chip/pill (shows current model name, tap to open a bottom-sheet picker — sheet is also grayscale, hairline-divided list, no card shadows).
- File/attachment icon-button aligned to the same row, opposite end from model selector.

**Row 2 (Input Row, standard text-input height):**
- Multiline-expandable text field (grows up to ~5 lines then scrolls internally), placeholder in mid-gray.
- Send button: circular, fills white with black glyph when text present; gray/disabled outline when empty.
- Mic-to-text quick-record button inline at the left or right of the text field (separate from the top-bar mic toggle, which is for live voice mode) — tap-hold to record, accent ring appears while recording.

## Interaction & Motion
- Minimal motion: opacity/position transitions under ~150–200ms, no spring/bounce physics, no parallax. This is both an Apple-restraint choice and a low-tier-device performance choice.
- No blur (`BackdropFilter`) anywhere — use solid surface-gray panels instead of frosted glass, since blur is expensive on weak GPUs.
- Haptic feedback (light impact) on send, mic toggle, and model selection — not on every tap.

## Accessibility & Resilience
- Maintain 4.5:1 contrast minimum even within grayscale (verify gray-on-black text values).
- All icon-only buttons need semantic labels for screen readers.
- Layout must reflow correctly down to small screens (iPhone SE-class width, ~375pt) and common low-tier Android widths (~360dp) without clipping the input row or top bar.

## Deliverable
Produce the full widget tree (Scaffold → top bar / chat list / bottom input column), using `Column` + `Expanded` for the three-zone layout, `ListView.builder` for the chat (not a fixed list — must handle long, streaming, growing histories without rebuild jank), and `SafeArea` handling for both top and bottom across notch/gesture-bar devices. Keep widget rebuilds scoped (no full-screen `setState` on every streamed token — isolate the active message bubble).
