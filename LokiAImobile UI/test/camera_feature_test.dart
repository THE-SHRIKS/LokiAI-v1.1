import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lokiai_app/diagnostics.dart';
import 'package:lokiai_app/features/camera_feature.dart';

/// permission_handler talks to the platform over this channel. Driving it
/// directly is what lets the grant/deny/permanently-denied branches be tested
/// without a device.
const MethodChannel _permissionChannel = MethodChannel(
  'flutter.baseflow.com/permissions/methods',
);

/// `availableCameras()` goes through the camera platform interface's default
/// method channel under flutter_test.
const MethodChannel _cameraChannel = MethodChannel('plugins.flutter.io/camera');

/// PermissionStatus indices, from permission_handler_platform_interface's
/// PermissionStatus enum declaration order.
const int _denied = 0;
const int _granted = 1;
const int _permanentlyDenied = 4;

/// Permission.camera's numeric value in the same package.
const int _cameraPermission = 1;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  /// Makes the capability check succeed so the permission branches below it are
  /// reachable. Production order is capability -> permission -> controller, as
  /// section 5 requires, so without this every test would stop at the first
  /// step.
  void stubCameras(List<Map<String, Object?>> cameras) {
    messenger.setMockMethodCallHandler(_cameraChannel, (call) async {
      if (call.method == 'availableCameras') return cameras;
      return null;
    });
  }

  const oneBackCamera = <Map<String, Object?>>[
    {
      'name': 'back-camera',
      'lensFacing': 'back',
      'sensorOrientation': 90,
    },
  ];

  void stubPermission(int status, {List<String>? calls}) {
    messenger.setMockMethodCallHandler(_permissionChannel, (call) async {
      calls?.add(call.method);
      switch (call.method) {
        case 'requestPermissions':
          return <int, int>{_cameraPermission: status};
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

  setUp(() {
    Diagnostics.resetForTest();
    stubCameras(oneBackCamera);
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(_permissionChannel, null);
    messenger.setMockMethodCallHandler(_cameraChannel, null);
  });

  test('starts idle and reports itself closed', () {
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);
    expect(controller.state, CameraFeatureState.idle);
    expect(controller.isOpen, isFalse);
    expect(controller.canCapture, isFalse);
  });

  test('a denied camera permission reaches permissionDenied, not a crash',
      () async {
    stubPermission(_denied);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.open(modelPath: null);

    expect(controller.state, CameraFeatureState.permissionDenied);
    expect(controller.statusMessage, contains('denied'));
    // Recoverable: the user is still on a working chat screen.
    expect(controller.isOpen, isTrue);
    expect(controller.canCapture, isFalse);
  });

  test('a permanently denied permission offers the settings path', () async {
    stubPermission(_permanentlyDenied);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.open(modelPath: null);

    expect(controller.state, CameraFeatureState.permissionPermanentlyDenied);
    expect(controller.statusMessage, contains('Settings'));
  });

  test('a missing camera plugin fails cleanly instead of crashing', () async {
    // A release build with a broken plugin registration raises
    // MissingPluginException here. It used to be unhandled, and therefore
    // fatal; it must now be a recorded, recoverable failure.
    messenger.setMockMethodCallHandler(_cameraChannel, null);
    stubPermission(_granted);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.open(modelPath: null);

    expect(controller.state, CameraFeatureState.failed);
    expect(controller.canCapture, isFalse);
    // The failure was recorded rather than swallowed.
    expect(
      Diagnostics.recent.map((r) => r.feature),
      contains('camera.enumerate'),
    );
  });

  test('a device reporting no cameras fails before asking for permission',
      () async {
    final calls = <String>[];
    stubCameras(const []);
    stubPermission(_granted, calls: calls);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.open(modelPath: null);

    expect(controller.state, CameraFeatureState.failed);
    expect(controller.statusMessage, contains('no camera'));
    expect(calls, isEmpty);
  });

  test('a granted permission proceeds past the permission gate', () async {
    // The controller is created only after the grant. There is no camera
    // implementation behind the channel to initialize against, so this lands
    // on failed -- the point is that it is a clean terminal state, never a
    // permission state and never an unhandled exception.
    stubPermission(_granted);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.open(modelPath: null);

    expect(
      controller.state,
      anyOf(CameraFeatureState.failed, CameraFeatureState.ready),
    );
    expect(controller.state, isNot(CameraFeatureState.permissionDenied));
  });

  test('rapid repeated taps do not start two open sequences', () async {
    final calls = <String>[];
    stubPermission(_denied, calls: calls);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await Future.wait([
      controller.open(modelPath: null),
      controller.open(modelPath: null),
      controller.open(modelPath: null),
    ]);

    // Exactly one permission request, so exactly one open sequence ran.
    expect(calls.where((c) => c == 'requestPermissions'), hasLength(1));
    expect(controller.state, CameraFeatureState.permissionDenied);
  });

  test('close returns to idle and reopening works', () async {
    stubPermission(_denied);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.open(modelPath: null);
    expect(controller.state, CameraFeatureState.permissionDenied);

    await controller.close();
    expect(controller.state, CameraFeatureState.idle);
    expect(controller.isOpen, isFalse);

    await controller.open(modelPath: null);
    expect(controller.state, CameraFeatureState.permissionDenied);
  });

  test('capture is a no-op unless the camera is ready', () async {
    stubPermission(_denied);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.open(modelPath: null);
    await controller.capture(); // must not throw

    expect(controller.state, CameraFeatureState.permissionDenied);
  });

  test('a disposed controller ignores further calls and notifies no one',
      () async {
    stubPermission(_denied);
    final controller = CameraFeatureController();
    var notifications = 0;
    controller.addListener(() => notifications++);

    controller.dispose();
    expect(controller.state, CameraFeatureState.disposed);

    // No setState-after-dispose equivalent: these must be silent no-ops.
    await controller.open(modelPath: null);
    await controller.capture();
    await controller.close();
    await controller.handleAppPaused();
    await controller.handleAppResumed();

    expect(notifications, 0);
  });

  test('dispose is idempotent', () async {
    final controller = CameraFeatureController();
    controller.dispose();
    controller.dispose(); // a second dispose must not throw
    expect(controller.state, CameraFeatureState.disposed);
  });

  test('background then foreground does not reopen a camera that was closed',
      () async {
    stubPermission(_denied);
    final controller = CameraFeatureController();
    addTearDown(controller.dispose);

    await controller.handleAppPaused();
    await controller.handleAppResumed();

    expect(controller.state, CameraFeatureState.idle);
  });
}
