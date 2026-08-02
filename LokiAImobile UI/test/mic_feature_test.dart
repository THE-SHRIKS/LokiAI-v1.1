import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/diagnostics.dart';
import 'package:lokiai_app/features/mic_feature.dart';

const MethodChannel _permissionChannel = MethodChannel(
  'flutter.baseflow.com/permissions/methods',
);

/// PermissionStatus indices, from permission_handler_platform_interface's
/// PermissionStatus enum declaration order.
const int _denied = 0;
const int _granted = 1;
const int _permanentlyDenied = 4;

/// Permission.microphone's numeric value in the same package.
const int _microphonePermission = 7;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  void stubPermission(int status, {List<String>? calls}) {
    messenger.setMockMethodCallHandler(_permissionChannel, (call) async {
      calls?.add(call.method);
      switch (call.method) {
        case 'requestPermissions':
          return <int, int>{_microphonePermission: status};
        case 'checkPermissionStatus':
          return status;
        case 'shouldShowRequestPermissionRationale':
          return false;
        case 'openAppSettings':
          return true;
      }
      return null;
    });
  }

  setUp(Diagnostics.resetForTest);

  tearDown(() {
    messenger.setMockMethodCallHandler(_permissionChannel, null);
  });

  test('starts idle', () {
    final controller = MicFeatureController();
    addTearDown(controller.dispose);
    expect(controller.state, MicFeatureState.idle);
    expect(controller.isListening, isFalse);
  });

  test('no deployed audio model fails without prompting for permission',
      () async {
    final calls = <String>[];
    stubPermission(_granted, calls: calls);
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await controller.start(modelPath: null);

    expect(controller.state, MicFeatureState.failed);
    expect(controller.statusMessage, contains('audio model'));
    // A permission we cannot make use of is never requested.
    expect(calls, isEmpty);
  });

  test('a non-tflite model is rejected before the recorder is touched',
      () async {
    final calls = <String>[];
    stubPermission(_granted, calls: calls);
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await controller.start(modelPath: '/data/models/chat.gguf');

    expect(controller.state, MicFeatureState.failed);
    expect(calls, isEmpty);
  });

  test('a denied microphone permission reaches permissionDenied', () async {
    stubPermission(_denied);
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await controller.start(modelPath: '/data/models/yamnet.tflite');

    expect(controller.state, MicFeatureState.permissionDenied);
    expect(controller.statusMessage, contains('Text chat still works'));
    expect(controller.isListening, isFalse);
  });

  test('a permanently denied permission offers the settings path', () async {
    stubPermission(_permanentlyDenied);
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await controller.start(modelPath: '/data/models/yamnet.tflite');

    expect(controller.state, MicFeatureState.permissionPermanentlyDenied);
    expect(controller.statusMessage, contains('Settings'));
  });

  test('a granted permission with a missing model file fails cleanly',
      () async {
    stubPermission(_granted);
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await controller.start(
      modelPath: '/definitely/not/a/real/path/yamnet.tflite',
    );

    expect(controller.state, MicFeatureState.failed);
    expect(controller.isListening, isFalse);
    // The message names the real problem instead of a generic failure.
    expect(controller.statusMessage.toLowerCase(), contains('model'));
  });

  test('rapid repeated taps do not start two recorder sessions', () async {
    final calls = <String>[];
    stubPermission(_denied, calls: calls);
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await Future.wait([
      controller.start(modelPath: '/data/models/yamnet.tflite'),
      controller.start(modelPath: '/data/models/yamnet.tflite'),
      controller.start(modelPath: '/data/models/yamnet.tflite'),
    ]);

    expect(calls.where((c) => c == 'requestPermissions'), hasLength(1));
  });

  test('stop from any state reaches idle', () async {
    stubPermission(_denied);
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await controller.start(modelPath: '/data/models/yamnet.tflite');
    await controller.stop();

    expect(controller.state, MicFeatureState.idle);
  });

  test('backgrounding while not listening is a no-op', () async {
    final controller = MicFeatureController();
    addTearDown(controller.dispose);

    await controller.handleAppPaused();

    expect(controller.state, MicFeatureState.idle);
  });

  test('a disposed controller ignores further calls', () async {
    stubPermission(_denied);
    final controller = MicFeatureController();
    var notifications = 0;
    controller.addListener(() => notifications++);

    controller.dispose();
    expect(controller.state, MicFeatureState.disposed);

    await controller.start(modelPath: '/data/models/yamnet.tflite');
    await controller.stop();
    await controller.toggle(modelPath: '/data/models/yamnet.tflite');
    await controller.handleAppPaused();

    expect(notifications, 0);
  });

  test('dispose is idempotent', () {
    final controller = MicFeatureController();
    controller.dispose();
    controller.dispose();
    expect(controller.state, MicFeatureState.disposed);
  });

  test('a microphone failure never touches the camera controller', () async {
    // Independence check: the mic controller owns nothing the camera owns, so
    // a failure here cannot disable the other feature.
    stubPermission(_denied);
    final mic = MicFeatureController();
    addTearDown(mic.dispose);

    await mic.start(modelPath: '/data/models/yamnet.tflite');

    expect(mic.state, MicFeatureState.permissionDenied);
    expect(Diagnostics.recent.where((r) => r.feature.startsWith('camera')),
        isEmpty);
  });
}
