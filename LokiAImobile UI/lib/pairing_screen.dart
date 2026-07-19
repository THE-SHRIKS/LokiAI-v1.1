import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Decoded payload of the dashboard pairing QR:
/// { "backend_url": "...", "token": "...", "user_id": "..." }
class PairingQrData {
  final String backendUrl;
  final String token;
  final String userId;

  const PairingQrData({
    required this.backendUrl,
    required this.token,
    required this.userId,
  });

  static PairingQrData? tryParse(String raw) {
    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, dynamic>) return null;
      final backendUrl = json['backend_url'] as String?;
      final token = json['token'] as String?;
      if (backendUrl == null || backendUrl.isEmpty ||
          token == null || token.isEmpty) {
        return null;
      }
      return PairingQrData(
        backendUrl: backendUrl,
        token: token,
        userId: json['user_id'] as String? ?? '',
      );
    } catch (_) {
      return null;
    }
  }
}

/// First screen shown when the app has no saved pairing data.
/// Camera viewfinder scans the dashboard QR code and decodes it.
/// Styling follows the locked LokiAI design (colors from main.dart).
class PairingScreen extends StatefulWidget {
  final Future<String?> Function(PairingQrData data) onScanned;

  const PairingScreen({super.key, required this.onScanned});

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    formats: const [BarcodeFormat.qrCode],
  );

  bool _processing = false;
  String? _statusMessage;
  bool _statusIsError = false;

  static const Color _baseBlack = Color(0xFF0A0A0A);
  static const Color _surface1 = Color(0xFF141414);
  static const Color _textPrimary = Color(0xFFF5F5F5);
  static const Color _textSecondary = Color(0xFF8A8A8A);
  static const Color _dividerGray = Color(0xFF3A3A3A);
  static const Color _accent = Color(0xFFE53935);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleDetection(BarcodeCapture capture) async {
    if (_processing) return;
    final raw = capture.barcodes.isNotEmpty
        ? capture.barcodes.first.rawValue
        : null;
    if (raw == null || raw.isEmpty) return;

    final data = PairingQrData.tryParse(raw);
    if (data == null) {
      setState(() {
        _statusMessage =
            'This QR code is not a LokiAI pairing code. Scan the code shown on your dashboard.';
        _statusIsError = true;
      });
      return;
    }

    // Task 2.2 verification: decoded values must appear in logs.
    // ignore: avoid_print
    print('VERIFICATION: qr_scan -> backend_url=${data.backendUrl} '
        'token=${data.token} user_id=${data.userId}');

    setState(() {
      _processing = true;
      _statusIsError = false;
      _statusMessage =
          'QR decoded.\nbackend_url: ${data.backendUrl}\ntoken: ${data.token}';
    });
    await _controller.stop();

    final error = await widget.onScanned(data);
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _processing = false;
        _statusIsError = true;
        _statusMessage = error;
      });
      await _controller.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _baseBlack,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              height: 56,
              decoration: const BoxDecoration(
                border: Border(
                    bottom: BorderSide(color: _dividerGray, width: 1)),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.centerLeft,
              child: const Text(
                'LokiAI',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: _textPrimary,
                  letterSpacing: -0.5,
                ),
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Scan QR code to connect to your dashboard',
              textAlign: TextAlign.center,
              style: TextStyle(color: _textPrimary, fontSize: 15),
            ),
            const SizedBox(height: 8),
            const Text(
              'Open the LokiAI dashboard and click "Add Device"',
              textAlign: TextAlign.center,
              style: TextStyle(color: _textSecondary, fontSize: 13),
            ),
            const SizedBox(height: 24),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    decoration: BoxDecoration(
                      color: _surface1,
                      border: Border.all(color: _dividerGray, width: 1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: _processing
                        ? const Center(
                            child: CircularProgressIndicator(
                                color: _textSecondary),
                          )
                        : MobileScanner(
                            controller: _controller,
                            onDetect: _handleDetection,
                            errorBuilder: (context, error) => Center(
                              child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: Text(
                                  'Camera unavailable: ${error.errorCode.name}. '
                                  'Grant camera permission in device settings.',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                      color: _accent, fontSize: 14),
                                ),
                              ),
                            ),
                          ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                _statusMessage ?? 'Point the camera at the QR code',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: _statusMessage == null
                      ? _textSecondary
                      : (_statusIsError ? _accent : _textPrimary),
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
