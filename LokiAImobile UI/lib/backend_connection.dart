import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:shared_preferences/shared_preferences.dart';

import 'device_registration.dart';
import 'model_downloader.dart';

/// Persistent WebSocket link to the backend (v3 wireless architecture).
/// Connects after pairing, stays up while the app is in the foreground,
/// reconnects every 5 seconds (up to 30 attempts) when dropped, sends
/// heartbeats, and hands deployment instructions to ModelDownloader.
class BackendConnection {
  static final BackendConnection instance = BackendConnection._();
  BackendConnection._();

  WebSocket? _socket;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  bool _started = false;
  String? _wsUrl;
  String? _deviceId;

  static const int maxReconnectAttempts = 30;
  static const Duration reconnectDelay = Duration(seconds: 5);
  static const Duration heartbeatInterval = Duration(seconds: 20);

  bool get isConnected => _socket != null && _socket!.readyState == WebSocket.open;

  /// Reads pairing data from SharedPreferences and opens the socket.
  /// Safe to call repeatedly — only the first call arms the connection.
  Future<void> start() async {
    if (_started) return;
    _started = true;

    final prefs = await SharedPreferences.getInstance();
    _deviceId = prefs.getString(DeviceRegistration.prefsDeviceId);
    _wsUrl = prefs.getString(DeviceRegistration.prefsWebsocketUrl);
    if ((_wsUrl == null || _wsUrl!.isEmpty) &&
        _deviceId != null && _deviceId!.isNotEmpty) {
      final backend = prefs.getString(DeviceRegistration.prefsBackendUrl);
      if (backend != null && backend.isNotEmpty) {
        final wsBase = backend
            .replaceFirst('https://', 'wss://')
            .replaceFirst('http://', 'ws://');
        _wsUrl = '$wsBase/ws/device/$_deviceId';
      }
    }

    if (_wsUrl == null || _wsUrl!.isEmpty ||
        _deviceId == null || _deviceId!.isEmpty) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> no pairing data saved, not connecting');
      _started = false;
      return;
    }
    await _connect();
  }

  Future<void> _connect() async {
    try {
      // ignore: avoid_print
      print('VERIFICATION: ws -> connecting to $_wsUrl');
      _socket = await WebSocket.connect(_wsUrl!)
          .timeout(const Duration(seconds: 15));
      _reconnectAttempts = 0;
      // ignore: avoid_print
      print('VERIFICATION: ws -> connected device_id=$_deviceId');

      _heartbeatTimer?.cancel();
      _heartbeatTimer =
          Timer.periodic(heartbeatInterval, (_) => _sendHeartbeat());

      _socket!.listen(
        _onMessage,
        onDone: () {
          // ignore: avoid_print
          print('VERIFICATION: ws -> closed by server or network');
          _onDisconnected();
        },
        onError: (Object e) {
          // ignore: avoid_print
          print('VERIFICATION: ws -> stream error: $e');
          _onDisconnected();
        },
        cancelOnError: true,
      );
    } on TimeoutException {
      // ignore: avoid_print
      print('VERIFICATION: ws -> connect timed out');
      _scheduleReconnect();
    } on SocketException catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> connect failed: ${e.message}');
      _scheduleReconnect();
    } on WebSocketException catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> websocket error: $e');
      _scheduleReconnect();
    }
  }

  void _onDisconnected() {
    _heartbeatTimer?.cancel();
    _socket = null;
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_reconnectAttempts >= maxReconnectAttempts) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> gave up after $maxReconnectAttempts attempts');
      return;
    }
    _reconnectAttempts += 1;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(reconnectDelay, () {
      // ignore: avoid_print
      print('VERIFICATION: ws -> reconnect attempt $_reconnectAttempts');
      _connect();
    });
  }

  void _sendHeartbeat() {
    send({
      'type': 'heartbeat',
      'device_id': _deviceId,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
    });
  }

  /// Sends a JSON payload to the backend. Silently drops when offline —
  /// deployment status still converges via retries and backend timeouts.
  void send(Map<String, dynamic> payload) {
    final socket = _socket;
    if (socket == null || socket.readyState != WebSocket.open) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> send skipped (not connected): '
          '${payload['type'] ?? payload['status'] ?? 'message'}');
      return;
    }
    socket.add(jsonEncode(payload));
  }

  void _onMessage(dynamic raw) {
    // ignore: avoid_print
    print('VERIFICATION: ws <- $raw');
    final Map<String, dynamic> data;
    try {
      final decoded = jsonDecode(raw as String);
      if (decoded is! Map<String, dynamic>) return;
      data = decoded;
    } catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> unreadable message: $e');
      return;
    }

    if (data['action'] == 'deploy') {
      ModelDownloader.handleDeploy(data, send);
    }
  }
}
