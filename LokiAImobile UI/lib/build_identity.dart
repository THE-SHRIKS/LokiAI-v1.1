/// Identity of this mobile build, reported to the backend so a release audit
/// can compare backend, dashboard, served APK and INSTALLED APK together.
///
/// The incident review could confirm the backend commit and the repo's APK
/// blob, but had no way to learn what was actually installed on a handset —
/// the phone never reported its own version. That gap is what made "prove all
/// running components are from the intended commit" unanswerable.
///
/// Values are compile-time constants rather than a runtime package lookup, so
/// this adds no dependency and cannot fail at report time. The build script
/// supplies them; the defaults mirror pubspec.yaml (`version: 1.0.10+12`) so
/// a plain `flutter build` still reports something truthful.
class BuildIdentity {
  /// Wire contract version between this app and the backend. Bumped when the
  /// WebSocket message shapes change.
  static const String protocolVersion = 'lokiai_android_runtime_1';

  /// Runtime adapter contract this build implements.
  static const String adapterVersion = '1';

  /// Adapters this build can actually validate and execute. Anything not
  /// listed here is rejected by ModelDownloader._validateRuntimeArtifact.
  static const List<String> supportedAdapters = <String>[
    'llama_cpp_gguf_chat_v1',
    'tflite_yamnet_audio_v1',
    'tflite_imagenet_classifier_v1',
  ];

  static const String applicationId = String.fromEnvironment(
    'LOKIAI_APPLICATION_ID',
    defaultValue: 'io.lokiai.lokiai_app',
  );

  static const String versionName = String.fromEnvironment(
    'LOKIAI_VERSION_NAME',
    defaultValue: '1.0.10',
  );

  static const String versionCode = String.fromEnvironment(
    'LOKIAI_VERSION_CODE',
    defaultValue: '12',
  );

  /// Git commit this APK was built from. Supply with
  /// `--dart-define=LOKIAI_BUILD_COMMIT=$(git rev-parse HEAD)`; reports
  /// 'unknown' when the build did not provide one, which is itself the
  /// honest answer rather than a guess.
  static const String commit = String.fromEnvironment(
    'LOKIAI_BUILD_COMMIT',
    defaultValue: 'unknown',
  );

  static Map<String, dynamic> report() => <String, dynamic>{
        'application_id': applicationId,
        'version_name': versionName,
        'version_code': versionCode,
        'build_commit': commit,
        'protocol_version': protocolVersion,
        'adapter_version': adapterVersion,
        'supported_adapters': supportedAdapters,
      };
}
