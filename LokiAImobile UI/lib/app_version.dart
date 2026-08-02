/// Application version, mirrored from `pubspec.yaml`.
///
/// Kept as a compile-time constant rather than pulled from a new
/// package-metadata dependency: crash reports must be able to state the exact
/// build even when plugin registration itself is what failed. `test/
/// app_version_test.dart` asserts these stay in sync with pubspec.yaml, so the
/// two cannot drift silently across a release.
const String kAppVersionName = '1.0.7';
const String kAppVersionCode = '8';
