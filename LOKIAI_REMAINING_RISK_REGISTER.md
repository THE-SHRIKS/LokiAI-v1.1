# LokiAI Remaining Risk Register

## P0 Risks
- **None**

## P1 Risks
- **None**

## P2 Risks
- The `packages/fllama/example` vendored test directory contains ~2000 syntax errors due to unmatched dependencies. While dead code, it clutters CI pipelines running strict `flutter analyze` from the project root.

## Mitigation
Exclude `packages/fllama/example` from the standard CI scope.
