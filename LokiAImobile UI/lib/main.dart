import 'dart:async';

import 'package:camera/camera.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_version.dart';
import 'backend_connection.dart';
import 'config_reader.dart';
import 'device_registration.dart';
import 'diagnostics.dart';
import 'features/camera_feature.dart';
import 'features/mic_feature.dart';
import 'loki_brand.dart';
import 'ml/chat_inference.dart';
import 'ml/model_guard.dart';
import 'pairing_screen.dart';
import 'widgets/model_selector_pill.dart';

void main() {
  // Every platform-channel call -- including SystemChrome below -- requires the
  // binding. It was previously invoked before `runApp` installed one, which is
  // a ServicesBinding assertion in debug and undefined ordering in release.
  //
  // runZonedGuarded is what makes an uncaught asynchronous error recoverable
  // instead of a fatal Android crash: the previous build had no top-level
  // handler at all, so any exception escaping a camera, recorder, or native
  // model future terminated the process, and the half-written state it left
  // behind is why the app then failed to reopen.
  runZonedGuarded<void>(
    () {
      WidgetsFlutterBinding.ensureInitialized();
      Diagnostics.install();
      Diagnostics.appVersion = kAppVersionName;
      Diagnostics.buildNumber = kAppVersionCode;
      unawaited(_recordAndroidVersion());

      SystemChrome.setSystemUIOverlayStyle(
        const SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.light,
          systemNavigationBarColor: LokiColors.baseBlack,
        ),
      );
      runApp(const LokiApp());
    },
    (Object error, StackTrace stack) {
      Diagnostics.capture(
        feature: 'zone',
        error: error,
        stackTrace: stack,
        fatalToProcess: false,
      );
    },
  );
}

Future<void> _recordAndroidVersion() async {
  // Best-effort context for crash records. A failure here must never affect
  // startup, so it is captured and dropped.
  await Diagnostics.guard('diagnostics.device_info', () async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    final info = await DeviceInfoPlugin().androidInfo;
    Diagnostics.androidVersion =
        'Android ${info.version.release} (SDK ${info.version.sdkInt})';
  });
}

// --- Theme & Colors ---
class LokiColors {
  static const Color baseBlack = Color(0xFF0A0A0A);
  static const Color surface1 = Color(0xFF141414);
  static const Color surface2 = Color(0xFF1C1C1C);
  static const Color textPrimary = Color(0xFFF5F5F5);
  static const Color textSecondary = Color(0xFF8A8A8A);
  static const Color dividerGray = Color(0xFF3A3A3A);
  static const Color accent = Color(0xFFE53935); // Single functional accent
}

class LokiApp extends StatelessWidget {
  const LokiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LokiAI',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: LokiColors.baseBlack,
        fontFamily: 'Roboto', // System font fallback
        colorScheme: const ColorScheme.dark(
          primary: LokiColors.textPrimary,
          surface: LokiColors.baseBlack,
        ),
        textTheme: const TextTheme(
          titleLarge: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: LokiColors.textPrimary,
          ),
          bodyLarge: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: LokiColors.textPrimary,
            height: 1.4,
          ),
          bodyMedium: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: LokiColors.textSecondary,
          ),
        ),
      ),
      home:
          const PairingGate(), // Checks pairing and shows QR scanner if disconnected
    );
  }
}

/// Decides the first screen: QR pairing scanner when the device has no saved
/// pairing data, otherwise the existing (unchanged) LokiAI home screen.
class PairingGate extends StatefulWidget {
  const PairingGate({super.key});

  @override
  State<PairingGate> createState() => _PairingGateState();
}

class _PairingGateState extends State<PairingGate> with WidgetsBindingObserver {
  // null = still checking, false = needs pairing, true = paired
  bool? _paired;
  // Set right after a successful in-session pairing to show confirmation.
  bool _justPaired = false;

  @override
  void initState() {
    super.initState();
    // The app had no lifecycle handling at all, so returning to the foreground
    // never triggered a reconnect -- with the old fixed-delay/30-attempt
    // backoff already exhausted, the phone stayed offline in the dashboard
    // until the app was force-restarted.
    WidgetsBinding.instance.addObserver(this);
    _checkPairing();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed && _paired == true) {
      // ignore: avoid_print
      print('VERIFICATION: lifecycle -> resumed, verifying backend link');
      BackendConnection.instance.resume();
    }
  }

  Future<void> _checkPairing() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final deviceId = prefs.getString(DeviceRegistration.prefsDeviceId);
      final backendUrl = prefs.getString(DeviceRegistration.prefsBackendUrl);
      final paired =
          deviceId != null &&
          deviceId.isNotEmpty &&
          backendUrl != null &&
          backendUrl.isNotEmpty;
      // ignore: avoid_print
      print(
        'VERIFICATION: pairing_gate -> paired=$paired '
        'device_id=${deviceId ?? "none"}',
      );
      if (paired) BackendConnection.instance.start();
      if (mounted) setState(() => _paired = paired);
    } catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: pairing_gate -> prefs error: $e');
      if (mounted) setState(() => _paired = false);
    }
  }

  Future<String?> _onScanned(PairingQrData data) async {
    final result = await DeviceRegistration.register(data);
    if (!result.ok) return result.error;
    // Re-arms the connection and clears any re-pair prompt.
    await BackendConnection.instance.restartAfterRePair();
    if (mounted) {
      setState(() {
        _justPaired = true;
        _paired = true;
      });
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (_paired == null) {
      return const Scaffold(
        backgroundColor: LokiColors.baseBlack,
        body: Center(
          child: CircularProgressIndicator(color: LokiColors.textSecondary),
        ),
      );
    }
    if (_paired == false) {
      return PairingScreen(onScanned: _onScanned);
    }
    // The backend rejected this device's credential (WebSocket close 4401):
    // missing/invalid token, a token for another device, or the device was
    // unpaired server-side. Retrying cannot fix any of those, so send the user
    // straight back through pairing rather than leaving the phone silently
    // offline. This is the migration path for installs that predate WebSocket
    // authentication.
    return ValueListenableBuilder<bool>(
      valueListenable: BackendConnection.instance.needsRePair,
      builder: (context, needsRePair, child) {
        if (needsRePair) {
          return PairingScreen(
            onScanned: _onScanned,
            notice:
                'This phone needs to be paired again. '
                'Scan a new QR code from the LokiAI dashboard to reconnect.',
          );
        }
        return child!;
      },
      child: _buildPairedUi(),
    );
  }

  Widget _buildPairedUi() {
    if (_justPaired) {
      return Scaffold(
        backgroundColor: LokiColors.baseBlack,
        body: SafeArea(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.check_circle,
                  color: Color(0xFF43A047),
                  size: 56,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Connected! Your device is paired.',
                  style: TextStyle(color: LokiColors.textPrimary, fontSize: 15),
                ),
                const SizedBox(height: 8),
                const Text(
                  'It now appears in your dashboard.',
                  style: TextStyle(
                    color: LokiColors.textSecondary,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 32),
                TextButton(
                  onPressed: () => setState(() => _justPaired = false),
                  style: TextButton.styleFrom(
                    backgroundColor: LokiColors.surface1,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 12,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: const BorderSide(
                        color: LokiColors.dividerGray,
                        width: 1,
                      ),
                    ),
                  ),
                  child: const Text(
                    'Continue',
                    style: TextStyle(
                      color: LokiColors.textPrimary,
                      fontSize: 14,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return const LokiHomeScreen();
  }
}

// --- Data Models ---
enum MessageRole { user, ai }

class ChatMessage {
  /// Stable identity for in-place updates.
  ///
  /// Streaming used to write to `_messages[_messages.length - 1]`, which is
  /// only correct while nothing else appends. A microphone result or a second
  /// send arriving mid-stream made the tokens overwrite the wrong bubble.
  final String id;
  final String text;
  final MessageRole role;
  final bool isStreaming;

  ChatMessage({
    required this.text,
    required this.role,
    String? id,
    this.isStreaming = false,
  }) : id = id ?? Diagnostics.newCorrelationId();

  ChatMessage copyWith({String? text, bool? isStreaming}) => ChatMessage(
    id: id,
    text: text ?? this.text,
    role: role,
    isStreaming: isStreaming ?? this.isStreaming,
  );
}

// --- Main Screen ---
class LokiHomeScreen extends StatefulWidget {
  const LokiHomeScreen({super.key});

  @override
  State<LokiHomeScreen> createState() => _LokiHomeScreenState();
}

class _LokiHomeScreenState extends State<LokiHomeScreen>
    with WidgetsBindingObserver {
  ConfigResult? _configResult;
  String _appStatus = 'loading'; // 'loading', 'no_model', 'error', 'ready'

  final TextEditingController _textController = TextEditingController();
  final List<ChatMessage> _messages = [];

  // Camera and microphone are independent features with their own lifecycles.
  // One failing must not affect the other, and neither may take the app down.
  final CameraFeatureController _camera = CameraFeatureController();
  final MicFeatureController _mic = MicFeatureController();

  /// Every model downloaded to this phone, from the on-device registry. The
  /// camera and microphone resolve their model from here, so they are not
  /// limited to whichever single model is currently active for chat.
  List<AppConfig> _installed = const [];

  ChatInference? _chatInference;
  late final VoidCallback _deploymentListener;
  Future<void> _runtimeQueue = Future.value();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _deploymentListener = _reloadAfterDeployment;
    BackendConnection.instance.deploymentRevision.addListener(
      _deploymentListener,
    );
    _camera.addListener(_onFeatureChanged);
    _mic.addListener(_onFeatureChanged);
    _mic.onResult = _onVoiceResult;
    _bootstrap();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    BackendConnection.instance.deploymentRevision.removeListener(
      _deploymentListener,
    );
    _camera.removeListener(_onFeatureChanged);
    _mic.removeListener(_onFeatureChanged);
    _camera.dispose();
    _mic.dispose();
    _textController.dispose();
    unawaited(_disposeInferenceRuntimes());
    super.dispose();
  }

  /// Both controllers notify from asynchronous platform callbacks, so this is
  /// the single place that must be safe against a disposed State.
  void _onFeatureChanged() {
    if (mounted) setState(() {});
  }

  void _onVoiceResult(String result) {
    if (!mounted) return;
    setState(() {
      _messages.add(ChatMessage(text: 'Heard: $result', role: MessageRole.ai));
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    switch (state) {
      case AppLifecycleState.inactive:
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        // Android reclaims the camera and microphone when the app leaves the
        // foreground. Releasing them explicitly is what makes reopening work.
        unawaited(_camera.handleAppPaused());
        unawaited(_mic.handleAppPaused());
        // The native chat context stays owned by ChatInference, but an active
        // completion must not keep running while Android backgrounds us.
        // cancel() is idempotent and waits for llama.cpp before a later model
        // switch can release its memory.
        unawaited(_chatInference?.cancel() ?? Future<void>.value());
      case AppLifecycleState.resumed:
        unawaited(_camera.handleAppResumed());
    }
  }

  Future<void> _bootstrap() async {
    // A native runtime that aborted the process leaves a marker behind. Read
    // it before anything can try that file again: this is what turns "the app
    // crashes every time I type" into a single crash followed by a clear
    // explanation.
    final crashedModel = await ModelGuard.recoverFromNativeCrash();
    if (crashedModel != null && mounted) {
      setState(() {
        _messages.add(
          ChatMessage(
            text:
                'The last model closed LokiAI while it was loading, so it '
                'has been disabled. Deploy a different chat model from the '
                'dashboard - a single-file .gguf under about 1 GB works best '
                'on this phone.',
            role: MessageRole.ai,
          ),
        );
      });
    }

    // Permissions are feature-scoped. Requesting camera, microphone and broad
    // storage access at launch made a denied camera indistinguishable from a
    // broken preview and violates modern Android permission guidance.
    await _loadModelRuntime();
  }

  Future<void> _reloadAfterDeployment() async {
    await _loadModelRuntime();
  }

  Future<void> _disposeInferenceRuntimes() async {
    final chat = _chatInference;
    _chatInference = null;
    try {
      await chat?.dispose();
    } catch (e) {
      debugPrint('CHAT: dispose failed: $e');
    }
  }

  /// Deployment, model switching, and initial boot can all request a runtime
  /// reload. Serialize them so an old runtime can never be disposed while a
  /// new native interpreter is being created.
  Future<void> _loadModelRuntime({bool? cameraGranted, bool? micGranted}) {
    _runtimeQueue = _runtimeQueue
        .then(
          (_) => _loadModelRuntimeNow(
            cameraGranted: cameraGranted,
            micGranted: micGranted,
          ),
        )
        .catchError((Object error, StackTrace stackTrace) {
          debugPrint('MODEL: runtime reload failed: $error\n$stackTrace');
          if (mounted) {
            setState(() {
              _appStatus = 'error';
            });
          }
        });
    return _runtimeQueue;
  }

  Future<void> _loadModelRuntimeNow({
    bool? cameraGranted,
    bool? micGranted,
  }) async {
    final configResult = await ConfigReader.load();
    // Every model this phone has downloaded, not just the active one. The
    // camera and microphone are separate features from chat and must not be
    // dead simply because the *active* deployment happens to be a chat model.
    final installed = await ConfigReader.loadInstalled();
    await _disposeInferenceRuntimes();
    // A model switch invalidates whatever runtime the camera has open.
    await _camera.close();

    if (!mounted) return;

    setState(() {
      _configResult = configResult;
      _installed = installed;

      if (configResult.error == 'no_model') {
        _appStatus = 'no_model';
      } else if (configResult.error != null) {
        _appStatus = 'error';
      } else {
        _appStatus = 'ready';
      }
    });

    // Do not load a native TFLite/GGUF runtime during app boot. A malformed or
    // incompatible model can fail below the Dart exception boundary and kill
    // Android before the user can even reopen the app. Runtimes are loaded
    // only when the user starts the matching feature (send, camera, or mic).
  }

  /// A downloaded TFLite model for [inferenceMode], or null if none exists.
  ///
  /// This used to consider only the ACTIVE deployment, which is why the
  /// microphone did nothing: config.json holds a single model, so with a chat
  /// model active the lookup returned null and the mic reported "deploy an
  /// audio model" even when an audio model was already downloaded. The active
  /// model is still preferred; the rest of the registry is the fallback, so
  /// camera and mic work alongside chat.
  String? _modelPathFor(String inferenceMode) {
    final active = _configResult?.config;
    if (active != null &&
        active.inferenceMode == inferenceMode &&
        active.modelPath.endsWith('.tflite')) {
      return active.modelPath;
    }
    for (final model in _installed) {
      if (model.inferenceMode == inferenceMode &&
          model.modelPath.endsWith('.tflite')) {
        return model.modelPath;
      }
    }
    return null;
  }

  /// The GGUF chat model to talk to, active deployment first.
  ///
  /// Same rule as [_modelPathFor], and for the same reason: only one model can
  /// be active at a time, so looking solely at the active one made chat go
  /// dead whenever a camera or voice model was deployed.
  String? _chatModelPath() {
    bool isChat(AppConfig c) =>
        c.llmPath != null ||
        (c.inferenceMode == 'chat' &&
            (c.modelPath.endsWith('.gguf') || c.modelPath.endsWith('.bin')));

    final active = _configResult?.config;
    if (active != null && isChat(active)) {
      return active.llmPath ?? active.modelPath;
    }
    for (final model in _installed) {
      if (isChat(model)) return model.llmPath ?? model.modelPath;
    }
    return null;
  }

  Future<void> _toggleCamera() async {
    HapticFeedback.lightImpact();
    // The controller collapses concurrent calls itself, so a rapid double tap
    // can no longer create two CameraControllers fighting for the device.
    if (_camera.isOpen) {
      await _camera.close();
      return;
    }
    await _camera.open(modelPath: _modelPathFor('camera'));
  }

  Future<void> _toggleMic() async {
    HapticFeedback.lightImpact();
    await _mic.toggle(modelPath: _modelPathFor('voice'));
    if (!mounted) return;
    // Denials and load failures are reported in chat so the user gets an
    // explanation rather than a dead button.
    final message = _mic.statusMessage;
    if (_mic.state == MicFeatureState.failed ||
        _mic.state == MicFeatureState.permissionDenied ||
        _mic.state == MicFeatureState.permissionPermanentlyDenied) {
      // A bad deployment should yield one actionable message, not a duplicate
      // bubble every time the user retries the microphone button.
      if (_messages.isNotEmpty &&
          _messages.last.role == MessageRole.ai &&
          _messages.last.text == message) {
        return;
      }
      setState(() {
        _messages.add(ChatMessage(text: message, role: MessageRole.ai));
      });
    }
  }

  /// Applies [update] to the message with [id], wherever it currently sits.
  void _updateMessage(String id, ChatMessage Function(ChatMessage) update) {
    if (!mounted) return;
    final index = _messages.indexWhere((m) => m.id == id);
    if (index < 0) return;
    setState(() => _messages[index] = update(_messages[index]));
  }

  /// True while an on-device generation is in flight. A second send is queued
  /// by ChatInference rather than silently dropped, but the button is disabled
  /// so a double tap cannot submit the same text twice.
  bool _generating = false;

  Future<void> _sendMessage() async {
    final prompt = _textController.text.trim();
    if (prompt.isEmpty || _generating) return;
    HapticFeedback.lightImpact();

    final correlationId = Diagnostics.newCorrelationId();
    final placeholder = ChatMessage(
      text: '',
      role: MessageRole.ai,
      isStreaming: true,
    );

    setState(() {
      _generating = true;
      _messages.add(ChatMessage(text: prompt, role: MessageRole.user));
      _textController.clear();
      _messages.add(placeholder);
    });

    // Every submitted message must reach a terminal state - completed, or
    // failed with the reason. The old code could leave the "Generating."
    // indicator up for ever when generateText's stream neither emitted nor
    // closed, and its onDone never fired if the stream errored.
    void finish(String text) {
      _updateMessage(
        placeholder.id,
        (m) =>
            m.copyWith(text: text.isEmpty ? m.text : text, isStreaming: false),
      );
      if (mounted) setState(() => _generating = false);
    }

    try {
      if (_chatInference == null) {
        final chatPath = _chatModelPath();
        if (chatPath == null ||
            !(chatPath.endsWith('.gguf') || chatPath.endsWith('.bin'))) {
          finish(
            'No chat model is deployed on this phone yet. '
            'Deploy a GGUF chat model from the LokiAI dashboard.',
          );
          return;
        }
        // Native loading is explicit and only happens after the app is fully
        // interactive. ChatInference converts ordinary load errors into a
        // visible reply instead of terminating the UI.
        final chat = ChatInference();
        _chatInference = chat;
        await chat.initialize(chatPath);
      }

      final chat = _chatInference;
      if (chat == null) {
        finish('The chat runtime is unavailable. Try reopening the app.');
        return;
      }

      final completion = Completer<void>();
      late final StreamSubscription<String> subscription;
      subscription = chat
          .generateText(prompt)
          .listen(
            (token) => _updateMessage(
              placeholder.id,
              (m) => m.copyWith(text: m.text + token),
            ),
            onDone: () {
              if (!completion.isCompleted) completion.complete();
            },
            onError: (Object error, StackTrace stackTrace) {
              Diagnostics.capture(
                feature: 'chat.generate',
                error: error,
                stackTrace: stackTrace,
                correlationId: correlationId,
              );
              if (!completion.isCompleted) completion.completeError(error);
            },
            cancelOnError: true,
          );

      try {
        await completion.future;
        final index = _messages.indexWhere((m) => m.id == placeholder.id);
        final produced = index >= 0 ? _messages[index].text : '';
        finish(
          produced.trim().isEmpty
              ? 'The model produced no output for that prompt. Try rephrasing.'
              : '',
        );
      } finally {
        await subscription.cancel();
      }
    } catch (error, stackTrace) {
      final record = Diagnostics.capture(
        feature: 'chat.send',
        error: error,
        stackTrace: stackTrace,
        correlationId: correlationId,
      );
      finish(
        'That message could not be answered on-device. '
        'Reference ${record.correlationId}.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: LokiColors.baseBlack,
      body: SafeArea(
        child: Column(
          children: [
            // Zone 1: Top Bar
            _buildTopBar(),

            // Zone 2: Center Chat Interface
            Expanded(child: _buildChatInterface()),

            // Zone 3: Bottom Input Bar
            _buildBottomInputBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Container(
      height: 56,
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(color: LokiColors.dividerGray, width: 1),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const LokiBrand(),
          Row(
            children: [
              _ControlIconButton(
                icon: Icons.camera_alt_outlined,
                activeIcon: Icons.camera_alt,
                isActive: _camera.isOpen,
                isGranted:
                    _camera.state != CameraFeatureState.permissionDenied &&
                    _camera.state !=
                        CameraFeatureState.permissionPermanentlyDenied,
                onTap: _toggleCamera,
                semanticLabel: 'Toggle Camera',
              ),
              const SizedBox(width: 8),
              _ControlIconButton(
                icon: Icons.mic_none,
                activeIcon: Icons.mic,
                isActive: _mic.isListening,
                isGranted:
                    _mic.state != MicFeatureState.permissionDenied &&
                    _mic.state != MicFeatureState.permissionPermanentlyDenied,
                onTap: _toggleMic,
                semanticLabel: 'Toggle Live Mic',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildChatInterface() {
    if (_appStatus == 'loading') {
      return const Center(
        child: CircularProgressIndicator(color: LokiColors.textSecondary),
      );
    }

    // These two states used to return early and unconditionally, so anything
    // already in the conversation was hidden. A camera or microphone message
    // added while no chat model was active therefore never appeared, and both
    // buttons looked completely dead. The empty state is now only shown when
    // there is genuinely nothing else to display.
    final hasContent = _messages.isNotEmpty || _camera.isOpen;

    if (_appStatus == 'no_model' && !hasContent) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.auto_awesome,
              color: LokiColors.textPrimary.withValues(alpha: 0.8),
              size: 32,
            ),
            const SizedBox(height: 16),
            const Text(
              'No model deployed yet.',
              style: TextStyle(color: LokiColors.textPrimary, fontSize: 15),
            ),
            const SizedBox(height: 8),
            const Text(
              'Deploy one from the LokiAI dashboard.',
              style: TextStyle(color: LokiColors.textSecondary, fontSize: 13),
            ),
          ],
        ),
      );
    }

    if (_appStatus == 'error' && !hasContent) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Text(
            'Error: ${_configResult?.error}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: LokiColors.accent),
          ),
        ),
      );
    }

    if (!hasContent) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.auto_awesome,
              color: LokiColors.textPrimary.withValues(alpha: 0.8),
              size: 32,
            ),
            const SizedBox(height: 16),
            const Text(
              'How can I help?',
              style: TextStyle(color: LokiColors.textSecondary, fontSize: 15),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      itemCount: _messages.length + (_camera.isOpen ? 1 : 0),
      itemBuilder: (context, index) {
        if (_camera.isOpen && index == 0) {
          return _buildInlineCameraPreview();
        }

        final msgIndex = _camera.isOpen ? index - 1 : index;
        final message = _messages[msgIndex];

        return _buildMessageBubble(message);
      },
    );
  }

  /// Renders the camera surface from `CameraFeatureController.state` alone.
  ///
  /// The previous implementation subscribed a `ValueListenableBuilder` to
  /// `CameraInference.isFireDetected`, a `ValueNotifier` that
  /// `CameraInference.dispose()` disposed. Closing the camera (or any model
  /// reload, which also disposed the runtime) therefore left a live listener on
  /// a disposed notifier, and the next frame threw
  /// `A ValueNotifier<bool> was used after being disposed` -- an unhandled
  /// FlutterError on the camera toggle path. It also allocated a throwaway
  /// `ValueNotifier` inside `build` on every rebuild when no camera was active.
  /// The controller is a ChangeNotifier owned by this State and disposed
  /// exactly once, in `dispose()`.
  Widget _buildInlineCameraPreview() {
    switch (_camera.state) {
      case CameraFeatureState.permissionDenied:
      case CameraFeatureState.permissionPermanentlyDenied:
        return _cameraNotice(
          icon: Icons.no_photography,
          title: 'Camera permission required',
          body: _camera.statusMessage,
          action:
              _camera.state == CameraFeatureState.permissionPermanentlyDenied
              ? _CameraAction('Open Settings', _camera.openSystemSettings)
              : _CameraAction('Try again', _toggleCamera),
        );
      case CameraFeatureState.failed:
        return _cameraNotice(
          icon: Icons.error_outline,
          title: 'Camera unavailable',
          body: _camera.statusMessage,
          action: _CameraAction('Try again', _toggleCamera),
        );
      case CameraFeatureState.idle:
      case CameraFeatureState.disposed:
        return const SizedBox.shrink();
      case CameraFeatureState.requestingPermission:
      case CameraFeatureState.initializing:
      case CameraFeatureState.ready:
      case CameraFeatureState.capturing:
      case CameraFeatureState.processing:
        return _cameraSurface();
    }
  }

  Widget _cameraNotice({
    required IconData icon,
    required String title,
    required String body,
    _CameraAction? action,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      decoration: BoxDecoration(
        color: LokiColors.surface1,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: LokiColors.dividerGray, width: 1),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: LokiColors.accent, size: 32),
          const SizedBox(height: 12),
          Text(
            title,
            style: const TextStyle(
              color: LokiColors.accent,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          Text(
            body,
            style: const TextStyle(
              color: LokiColors.textSecondary,
              fontSize: 12,
            ),
            textAlign: TextAlign.center,
          ),
          if (action != null) ...[
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => unawaited(Future.sync(action.onPressed)),
              child: Text(action.label),
            ),
          ],
          const SizedBox(height: 4),
          TextButton(
            onPressed: () => unawaited(_camera.close()),
            child: const Text(
              'Close camera',
              style: TextStyle(color: LokiColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }

  Widget _cameraSurface() {
    final controller = _camera.previewController;
    final busy =
        _camera.state == CameraFeatureState.capturing ||
        _camera.state == CameraFeatureState.processing;
    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      height: 320,
      width: double.infinity,
      decoration: BoxDecoration(
        color: LokiColors.surface1,
        borderRadius: BorderRadius.circular(12),
        border: _camera.fireDetected
            ? Border.all(color: LokiColors.accent, width: 4)
            : Border.all(color: LokiColors.dividerGray, width: 1),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (controller != null)
              CameraPreview(controller)
            else
              const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: LokiColors.textSecondary,
                      ),
                    ),
                    SizedBox(height: 12),
                    Text(
                      'Starting camera...',
                      style: TextStyle(
                        color: LokiColors.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            Positioned(
              top: 8,
              right: 8,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white, size: 20),
                style: IconButton.styleFrom(backgroundColor: Colors.black54),
                onPressed: () => unawaited(_camera.close()),
                tooltip: 'Close camera',
              ),
            ),
            Positioned(
              bottom: 16,
              left: 16,
              right: 16,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: _camera.fireDetected
                          ? LokiColors.accent.withValues(alpha: 0.85)
                          : Colors.black54,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _camera.lastResult ?? _camera.statusMessage,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Still capture ?' validation ?' recognition. Disabled while a
                  // capture is already running, so repeated taps cannot start
                  // two takePicture() calls on one controller.
                  GestureDetector(
                    onTap: _camera.canCapture
                        ? () => unawaited(_camera.capture())
                        : null,
                    child: Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _camera.canCapture
                            ? Colors.white
                            : Colors.white24,
                        border: Border.all(color: Colors.white70, width: 2),
                      ),
                      child: busy
                          ? const Padding(
                              padding: EdgeInsets.all(16),
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: LokiColors.baseBlack,
                              ),
                            )
                          : const Icon(
                              Icons.camera,
                              color: LokiColors.baseBlack,
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMessageBubble(ChatMessage message) {
    final isUser = message.role == MessageRole.user;

    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Row(
        mainAxisAlignment: isUser
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isUser) ...[
            const Icon(
              Icons.auto_awesome,
              size: 16,
              color: LokiColors.textSecondary,
            ),
            const SizedBox(width: 12),
          ],
          Flexible(
            child: isUser
                ? Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      color: LokiColors.surface2,
                      borderRadius: BorderRadius.circular(
                        16,
                      ).copyWith(bottomRight: const Radius.circular(4)),
                    ),
                    child: Text(
                      message.text,
                      style: const TextStyle(
                        color: LokiColors.textPrimary,
                        fontSize: 15,
                        height: 1.4,
                      ),
                    ),
                  )
                : message.isStreaming
                ? _buildThinkingIndicator()
                : Text(
                    message.text,
                    style: const TextStyle(
                      color: LokiColors.textPrimary,
                      fontSize: 15,
                      height: 1.4,
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildThinkingIndicator() {
    return const Padding(
      padding: EdgeInsets.only(top: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.circle, size: 8, color: LokiColors.accent),
          SizedBox(width: 6),
          Text(
            'Generating...',
            style: TextStyle(color: LokiColors.textSecondary, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomInputBar() {
    return Container(
      decoration: const BoxDecoration(
        color: LokiColors.baseBlack,
        border: Border(
          top: BorderSide(color: LokiColors.dividerGray, width: 1),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Row 1: Selector Row
          Row(
            children: [
              // Flexible caps the pill at the row's width, which is what stops
              // a long model id from overflowing the screen.
              Flexible(
                child: ModelSelectorPill(
                  label: _configResult?.config?.displayLabel ?? 'No model',
                  onTap: () => unawaited(_showModelPicker()),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Row 2: Input Row
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // Text Field
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: LokiColors.surface1,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: LokiColors.dividerGray, width: 1),
                  ),
                  child: TextField(
                    controller: _textController,
                    maxLines: 5,
                    minLines: 1,
                    style: const TextStyle(
                      color: LokiColors.textPrimary,
                      fontSize: 15,
                    ),
                    decoration: const InputDecoration(
                      hintText: 'Message Loki...',
                      hintStyle: TextStyle(
                        color: LokiColors.textSecondary,
                        fontSize: 15,
                      ),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),

              // Send Button
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: _textController,
                builder: (context, value, child) {
                  // Disabled while a generation is running: the on-device
                  // runtime handles one completion at a time, and a second tap
                  // used to produce a duplicate submission.
                  final hasText = value.text.trim().isNotEmpty && !_generating;
                  return GestureDetector(
                    onTap: hasText ? _sendMessage : null,
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      margin: const EdgeInsets.only(bottom: 4),
                      decoration: BoxDecoration(
                        color: hasText
                            ? LokiColors.textPrimary
                            : Colors.transparent,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: hasText
                              ? LokiColors.textPrimary
                              : LokiColors.dividerGray,
                          width: 1,
                        ),
                      ),
                      child: Icon(
                        Icons.arrow_upward,
                        color: hasText
                            ? LokiColors.baseBlack
                            : LokiColors.textSecondary,
                        size: 20,
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _showModelPicker() async {
    HapticFeedback.lightImpact();
    final models = await ConfigReader.loadInstalled();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: LokiColors.surface1,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(
              title: Text(
                'Downloaded models',
                style: TextStyle(color: LokiColors.textPrimary),
              ),
            ),
            if (models.isEmpty)
              const ListTile(
                title: Text(
                  'No downloaded models',
                  style: TextStyle(color: LokiColors.textSecondary),
                ),
              ),
            for (final model in models)
              ListTile(
                // The sheet is where the complete, untruncated identifier
                // lives, which is what makes ellipsising the pill safe.
                title: Text(
                  model.displayLabel,
                  style: const TextStyle(color: LokiColors.textPrimary),
                ),
                subtitle: Text(
                  model.modelName,
                  style: const TextStyle(color: LokiColors.textSecondary),
                ),
                trailing:
                    model.deploymentId == _configResult?.config?.deploymentId
                    ? const Icon(Icons.check, color: LokiColors.textPrimary)
                    : null,
                onTap: () async {
                  await ConfigReader.activate(model);
                  if (sheetContext.mounted) {
                    Navigator.pop(sheetContext);
                  }
                  await _loadModelRuntime();
                },
              ),
          ],
        ),
      ),
    );
  }
}

/// A labelled recovery action offered on a camera error card.
class _CameraAction {
  final String label;
  final FutureOr<void> Function() onPressed;
  const _CameraAction(this.label, this.onPressed);
}

// --- Custom Top Bar Control Button ---
class _ControlIconButton extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final bool isActive;
  final bool isGranted;
  final VoidCallback onTap;
  final String semanticLabel;

  const _ControlIconButton({
    required this.icon,
    required this.activeIcon,
    required this.isActive,
    required this.isGranted,
    required this.onTap,
    required this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticLabel,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: isActive ? LokiColors.textPrimary : Colors.transparent,
            shape: BoxShape.circle,
            border: Border.all(
              color: isGranted
                  ? (isActive ? LokiColors.textPrimary : LokiColors.textPrimary)
                  : LokiColors.dividerGray,
              width: 1,
            ),
          ),
          child: Stack(
            alignment: Alignment.topRight,
            children: [
              Icon(
                isActive ? activeIcon : icon,
                color: isGranted
                    ? (isActive ? LokiColors.baseBlack : LokiColors.textPrimary)
                    : LokiColors.dividerGray,
                size: 20,
              ),
              if (isActive)
                Positioned(
                  right: 0,
                  top: 0,
                  child: Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: LokiColors.accent,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
