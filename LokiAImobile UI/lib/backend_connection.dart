import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import 'config_reader.dart';
import 'device_registration.dart';
import 'model_downloader.dart';

/// Persistent WebSocket link to the backend (v3 wireless architecture).
/// Connects after pairing, reconnects with exponential backoff + jitter when
/// dropped, sends heartbeats, reports actual on-device state after every
/// (re)connect, and hands deployment instructions to ModelDownloader.
class BackendConnection {
  static final BackendConnection instance = BackendConnection._();
  BackendConnection._();

  WebSocket? _socket;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  bool _started = false;
  bool _connecting = false;
  String? _wsUrl;
  String? _deviceId;

  /// Backoff schedule. Previously a flat 5s retry that stopped permanently
  /// after 30 attempts (~2.5 min), so a phone offline any longer than that
  /// stayed disconnected until the app was manually relaunched — the direct
  /// cause of "phone still shows offline after I turned it back on". Retries
  /// now continue indefinitely; the delay grows instead of the attempts
  /// running out, and jitter keeps every paired device from reconnecting in
  /// lockstep after a backend restart.
  static const Duration minReconnectDelay = Duration(seconds: 2);
  static const Duration maxReconnectDelay = Duration(minutes: 2);
  static const Duration heartbeatInterval = Duration(seconds: 20);

  final Random _rng = Random();

  bool get isConnected => _socket != null && _socket!.readyState == WebSocket.open;

  /// Reads pairing data from SharedPreferences and opens the socket.
  /// Safe to call repeatedly — only the first call arms the connection.
  Future<void> start() async {
    if (_started) return;
    _started = true;

    if (!await _loadPairingData()) {
      _started = false;
      return;
    }
    await _connect();
  }

  /// Re-reads pairing data and reconnects immediately if the socket is down.
  /// Called when the app returns to the foreground: the reconnect timer may be
  /// deep into its backoff (or the OS may have frozen it entirely while
  /// backgrounded), and the user expects the phone to be online as soon as
  /// they open the app.
  Future<void> resume() async {
    if (!_started) {
      await start();
      return;
    }
    if (isConnected) {
      // Prove the link is really alive rather than assuming.
      _sendHeartbeat();
      return;
    }
    // ignore: avoid_print
    print('VERIFICATION: ws -> resume: reconnecting now');
    _reconnectTimer?.cancel();
    _reconnectAttempts = 0;
    await _loadPairingData();
    await _connect();
  }

  Future<bool> _loadPairingData() async {
    final prefs = await SharedPreferences.getInstance();
    _deviceId = prefs.getString(DeviceRegistration.prefsDeviceId);
    final deviceToken = prefs.getString(DeviceRegistration.prefsDeviceToken);
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

    // The backend requires a device-scoped token on the upgrade request. The
    // saved websocket_url from pairing already carries it; older installs
    // (paired before device tokens existed) have a stored token but a bare
    // URL, so attach it here.
    if (_wsUrl != null && _wsUrl!.isNotEmpty &&
        deviceToken != null && deviceToken.isNotEmpty &&
        !_wsUrl!.contains('token=')) {
      final sep = _wsUrl!.contains('?') ? '&' : '?';
      _wsUrl = '$_wsUrl${sep}token=$deviceToken';
    }

    if (_wsUrl == null || _wsUrl!.isEmpty ||
        _deviceId == null || _deviceId!.isEmpty) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> no pairing data saved, not connecting');
      return false;
    }
    if (deviceToken == null || deviceToken.isEmpty) {
      // Paired before device authentication shipped. The backend will refuse
      // the socket; the user has to re-pair once from the dashboard.
      // ignore: avoid_print
      print('VERIFICATION: ws -> no device token saved; re-pair required');
    }
    return true;
  }

  Future<void> _connect() async {
    // Guards against two connects racing (e.g. a resume() landing while the
    // backoff timer is already firing), which would leave an orphaned socket.
    if (_connecting || isConnected) return;
    _connecting = true;
    try {
      // ignore: avoid_print
      print('VERIFICATION: ws -> connecting (attempt ${_reconnectAttempts + 1})');
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
          print('VERIFICATION: ws -> closed (code=${_socket?.closeCode})');
          _onDisconnected();
        },
        onError: (Object e) {
          // ignore: avoid_print
          print('VERIFICATION: ws -> stream error: $e');
          _onDisconnected();
        },
        cancelOnError: true,
      );

      // Tell the backend what this device ACTUALLY has, so anything that
      // changed while the socket was down converges instead of the two sides
      // disagreeing forever.
      await _sendStateReport();
    } on TimeoutException {
      // ignore: avoid_print
      print('VERIFICATION: ws -> connect timed out');
      _socket = null;
      _scheduleReconnect();
    } on SocketException catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> connect failed: ${e.message}');
      _socket = null;
      _scheduleReconnect();
    } on WebSocketException catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> websocket error: $e');
      _socket = null;
      _scheduleReconnect();
    } finally {
      _connecting = false;
    }
  }

  void _onDisconnected() {
    _heartbeatTimer?.cancel();
    _socket = null;
    _scheduleReconnect();
  }

  /// Exponential backoff with full jitter, capped, and never giving up.
  void _scheduleReconnect() {
    _reconnectAttempts += 1;
    final expMs = minReconnectDelay.inMilliseconds * pow(2, _reconnectAttempts - 1);
    final cappedMs = min(expMs.toDouble(), maxReconnectDelay.inMilliseconds.toDouble());
    // Full jitter: pick uniformly in [min, capped] so a fleet of devices
    // reconnecting after a backend restart spreads out instead of stampeding.
    final jitteredMs = minReconnectDelay.inMilliseconds +
        _rng.nextInt(max(1, (cappedMs - minReconnectDelay.inMilliseconds).round() + 1));

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(milliseconds: jitteredMs), () {
      // ignore: avoid_print
      print('VERIFICATION: ws -> reconnect attempt $_reconnectAttempts '
          'after ${jitteredMs}ms');
      _connect();
    });
  }

  /// Reports the deployment/runtime state actually present on this device.
  Future<void> _sendStateReport() async {
    try {
      // ConfigReader.load() returns a ConfigResult wrapper: `config` is null
      // when nothing is deployed OR when the config failed to load, with the
      // reason in `error`. Only a successfully parsed config counts as a real
      // deployment — a read/parse failure must not be reported as 'complete'.
      final result = await ConfigReader.load();
      final cfg = result.config;
      send({
        'type': 'state_report',
        'device_id': _deviceId,
        'deployment_id': cfg?.deploymentId,
        'model_name': cfg?.modelName,
        'inference_mode': cfg?.inferenceMode,
        'status': cfg == null ? 'none' : 'complete',
        // Distinguishes "nothing deployed" from "a deployment exists but its
        // config is unreadable", so the backend does not silently treat a
        // broken install as a clean one.
        'config_error': result.error,
        'timestamp': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: ws -> state report skipped: $e');
    }
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
      return;
    }

    if (data['type'] == 'state_ack') {
      // Server's view of what is still outstanding for this device after our
      // state report. Logged for diagnosis; the server has already reconciled
      // anything the report resolved.
      final pending = data['pending_deployments'];
      // ignore: avoid_print
      print('VERIFICATION: ws -> state_ack pending=$pending');
    }
  }
}
