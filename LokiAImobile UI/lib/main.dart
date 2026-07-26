import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:camera/camera.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'backend_connection.dart';
import 'config_reader.dart';
import 'device_registration.dart';
import 'pairing_screen.dart';
import 'ml/camera_inference.dart';
import 'ml/chat_inference.dart';
import 'ml/voice_inference.dart';

void main() {
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: LokiColors.baseBlack,
  ));
  runApp(const LokiApp());
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
          titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: LokiColors.textPrimary),
          bodyLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w400, color: LokiColors.textPrimary, height: 1.4),
          bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: LokiColors.textSecondary),
        ),
      ),
      home: const PairingGate(), // Checks pairing and shows QR scanner if disconnected
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

class _PairingGateState extends State<PairingGate> {
  // null = still checking, false = needs pairing, true = paired
  bool? _paired;
  // Set right after a successful in-session pairing to show confirmation.
  bool _justPaired = false;

  @override
  void initState() {
    super.initState();
    _checkPairing();
  }

  Future<void> _checkPairing() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final deviceId = prefs.getString(DeviceRegistration.prefsDeviceId);
      final backendUrl = prefs.getString(DeviceRegistration.prefsBackendUrl);
      final paired = deviceId != null && deviceId.isNotEmpty &&
          backendUrl != null && backendUrl.isNotEmpty;
      // ignore: avoid_print
      print('VERIFICATION: pairing_gate -> paired=$paired '
          'device_id=${deviceId ?? "none"}');
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
    BackendConnection.instance.start();
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
    if (_justPaired) {
      return Scaffold(
        backgroundColor: LokiColors.baseBlack,
        body: SafeArea(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.check_circle,
                    color: Color(0xFF43A047), size: 56),
                const SizedBox(height: 16),
                const Text(
                  'Connected! Your device is paired.',
                  style: TextStyle(color: LokiColors.textPrimary, fontSize: 15),
                ),
                const SizedBox(height: 8),
                const Text(
                  'It now appears in your dashboard.',
                  style:
                      TextStyle(color: LokiColors.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 32),
                TextButton(
                  onPressed: () => setState(() => _justPaired = false),
                  style: TextButton.styleFrom(
                    backgroundColor: LokiColors.surface1,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 32, vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: const BorderSide(
                          color: LokiColors.dividerGray, width: 1),
                    ),
                  ),
                  child: const Text(
                    'Continue',
                    style:
                        TextStyle(color: LokiColors.textPrimary, fontSize: 14),
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
  final String text;
  final MessageRole role;
  final bool isStreaming;

  ChatMessage({required this.text, required this.role, this.isStreaming = false});
}

// --- Main Screen ---
class LokiHomeScreen extends StatefulWidget {
  const LokiHomeScreen({super.key});

  @override
  State<LokiHomeScreen> createState() => _LokiHomeScreenState();
}

class _LokiHomeScreenState extends State<LokiHomeScreen> {
  bool _isCameraActive = false;
  bool _isMicLive = false; // Top bar mic state
  
  bool _cameraGranted = false;
  bool _micGranted = false;
  
  ConfigResult? _configResult;
  String _appStatus = 'loading'; // 'loading', 'no_model', 'error', 'ready'

  final TextEditingController _textController = TextEditingController();
  final List<ChatMessage> _messages = [];
  bool _isRecordingVoiceMessage = false;
  
  CameraInference? _cameraInference;
  String _cameraInferenceResult = "Initializing ML...";
  
  ChatInference? _chatInference;
  VoiceInference? _voiceInference;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _cameraInference?.dispose();
    _chatInference?.dispose();
    _voiceInference?.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final camStatus = await Permission.camera.request();
    final micStatus = await Permission.microphone.request();
    await Permission.manageExternalStorage.request();
    await Permission.storage.request();

    final configResult = await ConfigReader.load();

    setState(() {
      _cameraGranted = camStatus.isGranted;
      _micGranted = micStatus.isGranted;
      _configResult = configResult;
      
      if (configResult.error == 'no_model') {
        _appStatus = 'no_model';
      } else if (configResult.error != null) {
        _appStatus = 'error';
      } else {
        _appStatus = 'ready';
        _isCameraActive = configResult.config?.inferenceMode == 'camera' || configResult.config?.modelPath != null;
        
        // Initialize camera inference if we have a TFLite model
        if (configResult.config?.modelPath != null && configResult.config!.modelPath!.endsWith('.tflite')) {
          _cameraInference = CameraInference();
          _cameraInference!.initialize(configResult.config!.modelPath!, (result) {
            if (mounted) {
              setState(() {
                _cameraInferenceResult = result;
              });
            }
          });
        }
        
        // Initialize chat inference if we have an LLM path or inference mode is chat
        final chatModelPath = configResult.config?.llmPath ?? 
            (configResult.config?.inferenceMode == 'chat' ? configResult.config?.modelPath : null);
            
        if (chatModelPath != null && (chatModelPath.endsWith('.gguf') || chatModelPath.endsWith('.bin'))) {
          _chatInference = ChatInference();
          _chatInference!.initialize(chatModelPath);
        }
        
        // Initialize voice inference
        if (configResult.config?.inferenceMode == 'voice' && configResult.config?.modelPath != null) {
          _voiceInference = VoiceInference();
          _voiceInference!.initialize(configResult.config!.modelPath!);
        }
      }
    });
  }

  void _toggleCamera() {
    HapticFeedback.lightImpact();
    setState(() {
      _isCameraActive = !_isCameraActive;
    });
  }

  void _toggleMic() {
    HapticFeedback.lightImpact();
    final newState = !_isMicLive;
    setState(() {
      _isMicLive = newState;
    });
    if (_voiceInference != null) {
      if (newState) {
        // Start recording and run model
        _voiceInference!.startListening((result) {
          if (mounted) {
            setState(() {
              _messages.add(ChatMessage(text: 'Voice result: $result', role: MessageRole.ai));
            });
          }
        });
      } else {
        // Stop recording
        _voiceInference!.stopListening();
      }
    }
  }

  void _sendMessage() {
    if (_textController.text.trim().isEmpty) return;
    HapticFeedback.lightImpact();
    
    final prompt = _textController.text.trim();

    setState(() {
      _messages.add(ChatMessage(text: prompt, role: MessageRole.user));
      _textController.clear();
      
      _messages.add(ChatMessage(text: "", role: MessageRole.ai, isStreaming: true));
    });

    if (_chatInference != null) {
      _chatInference!.generateText(prompt).listen((token) {
        if (mounted) {
          setState(() {
            final lastIdx = _messages.length - 1;
            final currentMsg = _messages[lastIdx];
            _messages[lastIdx] = ChatMessage(
              text: currentMsg.text + token,
              role: MessageRole.ai,
              isStreaming: true,
            );
          });
        }
      }, onDone: () {
        if (mounted) {
          setState(() {
            final lastIdx = _messages.length - 1;
            final currentMsg = _messages[lastIdx];
            _messages[lastIdx] = ChatMessage(
              text: currentMsg.text,
              role: MessageRole.ai,
              isStreaming: false,
            );
          });
        }
      });
    } else {
      // Mock stream finish after a delay
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) {
          setState(() {
            final lastIdx = _messages.length - 1;
            _messages[lastIdx] = ChatMessage(
              text: "Chat model not initialized.",
              role: MessageRole.ai,
              isStreaming: false,
            );
          });
        }
      });
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
            Expanded(
              child: _buildChatInterface(),
            ),
            
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
        border: Border(bottom: BorderSide(color: LokiColors.dividerGray, width: 1)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            'LokiAI',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: LokiColors.textPrimary,
              letterSpacing: -0.5,
            ),
          ),
          Row(
            children: [
              _ControlIconButton(
                icon: Icons.camera_alt_outlined,
                activeIcon: Icons.camera_alt,
                isActive: _isCameraActive,
                isGranted: _cameraGranted,
                onTap: _toggleCamera,
                semanticLabel: 'Toggle Camera',
              ),
              const SizedBox(width: 8),
              _ControlIconButton(
                icon: Icons.mic_none,
                activeIcon: Icons.mic,
                isActive: _isMicLive,
                isGranted: _micGranted,
                onTap: _toggleMic,
                semanticLabel: 'Toggle Live Mic',
              ),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildChatInterface() {
    if (_appStatus == 'loading') {
      return const Center(child: CircularProgressIndicator(color: LokiColors.textSecondary));
    }
    
    if (_appStatus == 'no_model') {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.auto_awesome, color: LokiColors.textPrimary.withOpacity(0.8), size: 32),
            const SizedBox(height: 16),
            const Text(
              'No model deployed yet.',
              style: TextStyle(color: LokiColors.textPrimary, fontSize: 15),
            ),
            const SizedBox(height: 8),
            const Text(
              'Connect to laptop to deploy.',
              style: TextStyle(color: LokiColors.textSecondary, fontSize: 13),
            ),
          ],
        ),
      );
    }
    
    if (_appStatus == 'error') {
      return Center(child: Text('Error: ${_configResult?.error}', style: const TextStyle(color: LokiColors.accent)));
    }

    if (_messages.isEmpty && !_isCameraActive) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.auto_awesome, color: LokiColors.textPrimary.withOpacity(0.8), size: 32),
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
      itemCount: _messages.length + (_isCameraActive ? 1 : 0),
      itemBuilder: (context, index) {
        if (_isCameraActive && index == 0) {
          return _buildInlineCameraPreview();
        }

        final msgIndex = _isCameraActive ? index - 1 : index;
        final message = _messages[msgIndex];

        return _buildMessageBubble(message);
      },
    );
  }

  Widget _buildInlineCameraPreview() {
    // Show camera permission denied state
    if (!_cameraGranted) {
      return Container(
        margin: const EdgeInsets.only(bottom: 24),
        height: 300,
        width: double.infinity,
        decoration: BoxDecoration(
          color: LokiColors.surface1,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: LokiColors.dividerGray, width: 1),
        ),
        child: const Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.no_photography, color: LokiColors.accent, size: 32),
              SizedBox(height: 12),
              Text(
                'Camera permission required',
                style: TextStyle(color: LokiColors.accent, fontSize: 14, fontWeight: FontWeight.w600),
              ),
              SizedBox(height: 4),
              Text(
                'Grant camera access in device settings',
                style: TextStyle(color: LokiColors.textSecondary, fontSize: 12),
              ),
            ],
          ),
        ),
      );
    }

    // Real camera preview with ValueNotifier fire detection
    return ValueListenableBuilder<bool>(
      valueListenable: _cameraInference?.isFireDetected ?? ValueNotifier<bool>(false),
      builder: (context, fireDetected, _) {
        return Container(
          margin: const EdgeInsets.only(bottom: 24),
          height: 300,
          width: double.infinity,
          decoration: BoxDecoration(
            color: LokiColors.surface1,
            borderRadius: BorderRadius.circular(12),
            border: fireDetected
                ? Border.all(color: LokiColors.accent, width: 4)
                : Border.all(color: LokiColors.dividerGray, width: 1),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (_cameraInference?.cameraController?.value.isInitialized == true)
                  CameraPreview(_cameraInference!.cameraController!)
                else
                  const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.camera_alt, color: LokiColors.textSecondary),
                        SizedBox(height: 8),
                        Text('Camera Initializing...', style: TextStyle(color: LokiColors.textSecondary, fontSize: 13)),
                      ],
                    ),
                  ),
                // Fire detection overlay
                Positioned(
                  bottom: 16,
                  left: 16,
                  right: 16,
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: fireDetected ? LokiColors.accent.withOpacity(0.85) : Colors.black54,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      fireDetected ? '\uD83D\uDD25 FIRE DETECTED' : _cameraInferenceResult,
                      style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildMessageBubble(ChatMessage message) {
    final isUser = message.role == MessageRole.user;

    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isUser) ...[
            const Icon(Icons.auto_awesome, size: 16, color: LokiColors.textSecondary),
            const SizedBox(width: 12),
          ],
          Flexible(
            child: isUser
                ? Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: LokiColors.surface2,
                      borderRadius: BorderRadius.circular(16).copyWith(bottomRight: const Radius.circular(4)),
                    ),
                    child: Text(
                      message.text,
                      style: const TextStyle(color: LokiColors.textPrimary, fontSize: 15, height: 1.4),
                    ),
                  )
                : message.isStreaming
                    ? _buildThinkingIndicator()
                    : Text(
                        message.text,
                        style: const TextStyle(color: LokiColors.textPrimary, fontSize: 15, height: 1.4),
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
          Text('Generating...', style: TextStyle(color: LokiColors.textSecondary, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildBottomInputBar() {
    return Container(
      decoration: const BoxDecoration(
        color: LokiColors.baseBlack,
        border: Border(top: BorderSide(color: LokiColors.dividerGray, width: 1)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Row 1: Selector Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              GestureDetector(
                onTap: () {
                  HapticFeedback.lightImpact();
                  // Show model selector sheet
                },
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
                      Text(_configResult?.config?.displayLabel ?? 'No model', style: const TextStyle(color: LokiColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w500)),
                      const SizedBox(width: 4),
                      Icon(Icons.keyboard_arrow_down, size: 16, color: LokiColors.textSecondary),
                    ],
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.attach_file, color: LokiColors.textSecondary, size: 20),
                onPressed: () {},
                tooltip: 'Attach File',
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
          const SizedBox(height: 12),
          
          // Row 2: Input Row
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // Mic to text inline
              GestureDetector(
                onLongPressStart: (_) {
                  setState(() => _isRecordingVoiceMessage = true);
                  HapticFeedback.lightImpact();
                  if (_voiceInference != null) {
                    _voiceInference!.startListening((result) {
                      if (mounted) {
                        setState(() {
                          _messages.add(ChatMessage(text: "Voice ML Output: $result", role: MessageRole.ai));
                        });
                      }
                    });
                  }
                },
                onLongPressEnd: (_) async {
                  setState(() => _isRecordingVoiceMessage = false);
                  HapticFeedback.lightImpact();
                  if (_voiceInference != null) {
                    await _voiceInference!.stopListening();
                  }
                },
                child: Container(
                  padding: const EdgeInsets.all(10),
                  margin: const EdgeInsets.only(right: 8, bottom: 4),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: _isRecordingVoiceMessage ? LokiColors.accent : LokiColors.dividerGray,
                      width: _isRecordingVoiceMessage ? 2 : 1,
                    ),
                  ),
                  child: Icon(
                    Icons.mic,
                    color: _isRecordingVoiceMessage ? LokiColors.accent : LokiColors.textSecondary,
                    size: 20,
                  ),
                ),
              ),
              
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
                    style: const TextStyle(color: LokiColors.textPrimary, fontSize: 15),
                    decoration: const InputDecoration(
                      hintText: 'Message Loki...',
                      hintStyle: TextStyle(color: LokiColors.textSecondary, fontSize: 15),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    ),
                    onChanged: (text) => setState(() {}), // rebuilds to update send button state
                  ),
                ),
              ),
              const SizedBox(width: 8),
              
              // Send Button
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: _textController,
                builder: (context, value, child) {
                  final hasText = value.text.trim().isNotEmpty;
                  return GestureDetector(
                    onTap: hasText ? _sendMessage : null,
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      margin: const EdgeInsets.only(bottom: 4),
                      decoration: BoxDecoration(
                        color: hasText ? LokiColors.textPrimary : Colors.transparent,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: hasText ? LokiColors.textPrimary : LokiColors.dividerGray,
                          width: 1,
                        ),
                      ),
                      child: Icon(
                        Icons.arrow_upward,
                        color: hasText ? LokiColors.baseBlack : LokiColors.textSecondary,
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
              color: isGranted ? (isActive ? LokiColors.textPrimary : LokiColors.textPrimary) : LokiColors.dividerGray,
              width: 1,
            ),
          ),
          child: Stack(
            alignment: Alignment.topRight,
            children: [
              Icon(
                isActive ? activeIcon : icon,
                color: isGranted ? (isActive ? LokiColors.baseBlack : LokiColors.textPrimary) : LokiColors.dividerGray,
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
