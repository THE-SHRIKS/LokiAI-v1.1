import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'config_reader.dart';
import 'device_credential_store.dart';
import 'device_registration.dart';
import 'diagnostics.dart';
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

  /// Application close codes sent by the backend (see device_websocket in
  /// LokiAI-backend/main.py). 4401 means this device's credential is missing,
  /// invalid, for a different device, or the device is no longer paired —
  /// none of which retrying can fix.
  static const int closeUnauthorized = 4401;
  static const int closeSuperseded = 4000;

  final Random _rng = Random();

  // A deployment status update (e.g. 'complete' after a slow model load)
  // sent at the exact instant the socket happened to be down was previously
  // dropped forever — send() had no queue, and the reconnect path only
  // re-reports whatever is on disk ('downloaded'), never the real outcome.
  // The backend then had nothing to go on but its own staleness clock,
  // which eventually marks a deployment that actually succeeded as "failed"
  // ("Timed out: phone stopped reporting progress") purely because the one
  // message that would have said otherwise never survived a momentary
  // disconnect. Buffering here and flushing on every reconnect closes that
  // gap for any transient drop, regardless of device or model size.
  static const int _maxPendingSends = 20;
  final List<Map<String, dynamic>> _pendingSends = [];

  /// True once the backend has rejected our credential. The UI watches this to
  /// prompt a re-pair instead of leaving the user staring at a device that
  /// silently never comes online. Retrying is suspended while set.
  final ValueNotifier<bool> needsRePair = ValueNotifier<bool>(false);

  /// Increments after a deployment has finished downloading. The home screen
  /// listens to this so a newly deployed model becomes available immediately,
  /// without asking the user to close and reopen the app.
  final ValueNotifier<int> deploymentRevision = ValueNotifier<int>(0);

  bool get isConnected =>
      _socket != null && _socket!.readyState == WebSocket.open;

  /// Reads pairing data from SharedPreferences and opens the socket.
  /// Safe to call repeatedly — only the first call arms the connection.
  Future<void> start() async {
    if (_started) return;
    _started = true;

    try {
      if (!await _loadPairingData()) {
        _started = false;
        return;
      }
      await _connect();
    } catch (error, stackTrace) {
      _started = false;
      Diagnostics.capture(
        feature: 'backend_connection.start',
        error: error,
        stackTrace: stackTrace,
      );
    }
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
    try {
      await _loadPairingData();
      await _connect();
    } catch (error, stackTrace) {
      Diagnostics.capture(
        feature: 'backend_connection.resume',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<bool> _loadPairingData() async {
    final prefs = await SharedPreferences.getInstance();
    _deviceId = prefs.getString(DeviceRegistration.prefsDeviceId);
    // Keystore-backed; also migrates any plaintext token left by an older build.
    final deviceToken = await DeviceCredentialStore.read();
    _wsUrl = prefs.getString(DeviceRegistration.prefsWebsocketUrl);

    if ((_wsUrl == null || _wsUrl!.isEmpty) &&
        _deviceId != null &&
        _deviceId!.isNotEmpty) {
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
    if (_wsUrl != null &&
        _wsUrl!.isNotEmpty &&
        deviceToken != null &&
        deviceToken.isNotEmpty &&
        !_wsUrl!.contains('token=')) {
      final sep = _wsUrl!.contains('?') ? '&' : '?';
      _wsUrl = '$_wsUrl${sep}token=$deviceToken';
    }

    if (_wsUrl == null ||
        _wsUrl!.isEmpty ||
        _deviceId == null ||
        _deviceId!.isEmpty) {
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
      print(
        'VERIFICATION: ws -> connecting (attempt ${_reconnectAttempts + 1})',
      );
      _socket = await WebSocket.connect(
        _wsUrl!,
      ).timeout(const Duration(seconds: 15));
      _reconnectAttempts = 0;
      // ignore: avoid_print
      print('VERIFICATION: ws -> connected device_id=$_deviceId');

      _heartbeatTimer?.cancel();
      _heartbeatTimer = Timer.periodic(
        heartbeatInterval,
        (_) => _sendHeartbeat(),
      );

      _socket!.listen(
        _onMessage,
        onDone: () {
          final code = _socket?.closeCode;
          // ignore: avoid_print
          print('VERIFICATION: ws -> closed (code=$code)');
          if (code == closeUnauthorized) {
            _onCredentialRejected();
            return;
          }
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
      // disagreeing forever. This is a conservative floor read from disk
      // ('downloaded' at best) — _flushPending() runs right after and sends
      // anything more current (validating/complete/failed) that was queued
      // while the socket was unavailable, so a real outcome always overrides
      // this baseline instead of the other way around.
      await _sendStateReport();
      _flushPending();
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
    } catch (error, stackTrace) {
      Diagnostics.capture(
        feature: 'backend_connection.connect',
        error: error,
        stackTrace: stackTrace,
      );
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

  /// The backend rejected this device's credential (close 4401).
  ///
  /// Retrying cannot succeed — the token is invalid, belongs to another
  /// device, or the device was unpaired server-side. Stop the reconnect loop,
  /// discard the dead credential so it cannot be replayed, and surface a
  /// re-pair prompt. This is the controlled migration path for installs that
  /// predate WebSocket authentication; there is deliberately no unauthenticated
  /// fallback.
  void _onCredentialRejected() {
    // ignore: avoid_print
    print(
      'VERIFICATION: ws -> credential rejected by backend; re-pair required',
    );
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    _socket = null;
    _started = false;
    DeviceCredentialStore.clear();
    needsRePair.value = true;
  }

  /// Called after a successful re-pair so the connection can be armed again.
  Future<void> restartAfterRePair() async {
    needsRePair.value = false;
    _reconnectAttempts = 0;
    _started = false;
    await start();
  }

  /// Exponential backoff with full jitter, capped, and never giving up.
  void _scheduleReconnect() {
    _reconnectAttempts += 1;
    final expMs =
        minReconnectDelay.inMilliseconds * pow(2, _reconnectAttempts - 1);
    final cappedMs = min(
      expMs.toDouble(),
      maxReconnectDelay.inMilliseconds.toDouble(),
    );
    // Full jitter: pick uniformly in [min, capped] so a fleet of devices
    // reconnecting after a backend restart spreads out instead of stampeding.
    final jitteredMs =
        minReconnectDelay.inMilliseconds +
        _rng.nextInt(
          max(1, (cappedMs - minReconnectDelay.inMilliseconds).round() + 1),
        );

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(milliseconds: jitteredMs), () {
      // ignore: avoid_print
      print(
        'VERIFICATION: ws -> reconnect attempt $_reconnectAttempts '
        'after ${jitteredMs}ms',
      );
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
        'status': cfg == null ? 'none' : 'downloaded',
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

  /// Sends a JSON payload to the backend. If the socket is down, deployment
  /// and runtime-event updates are queued and redelivered on the next
  /// reconnect instead of being lost — those carry a one-time outcome
  /// (validating/complete/failed) that nothing else will ever re-send.
  /// Heartbeats and state reports are point-in-time and always regenerated
  /// fresh, so queuing a stale one would be actively wrong; they're dropped
  /// as before.
  void send(Map<String, dynamic> payload) {
    final socket = _socket;
    if (socket == null || socket.readyState != WebSocket.open) {
      final type = payload['type'];
      final isRequeueable = type != 'heartbeat' && type != 'state_report';
      // ignore: avoid_print
      print(
        'VERIFICATION: ws -> send ${isRequeueable ? "queued" : "skipped"} '
        '(not connected): ${type ?? payload['status'] ?? 'message'}',
      );
      if (isRequeueable) {
        _pendingSends.add(payload);
        while (_pendingSends.length > _maxPendingSends) {
          _pendingSends.removeAt(0);
        }
      }
      return;
    }
    socket.add(jsonEncode(payload));
  }

  /// Redelivers anything queued by send() while the socket was down. Runs
  /// after every successful (re)connect, right after _sendStateReport() so a
  /// real outcome always lands on top of that conservative disk-read floor.
  void _flushPending() {
    if (_pendingSends.isEmpty) return;
    final queued = List<Map<String, dynamic>>.from(_pendingSends);
    _pendingSends.clear();
    // ignore: avoid_print
    print('VERIFICATION: ws -> flushing ${queued.length} queued message(s)');
    for (final payload in queued) {
      send(payload);
    }
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
      unawaited(
        Diagnostics.guard(
          'backend_connection.deployment',
          () => _handleDeployment(data),
        ),
      );
      return;
    }

    if (data['action'] == 'cancel_deployment') {
      final deploymentId = data['deployment_id'] as String?;
      if (deploymentId != null && deploymentId.isNotEmpty) {
        ModelDownloader.cancel(deploymentId);
      }
      return;
    }

    if (data['type'] == 'state_ack') {
      // Server's view of what is still outstanding for this device after our
      // state report. Anything the report itself resolved is already
      // reconciled server-side. What's left here is every deployment the
      // BACKEND still considers active (queued/downloading/downloaded/
      // validating) for this device. Handled asynchronously because
      // resolving it safely needs a read of the local registry — see
      // _handleStateAck for why.
      unawaited(_handleStateAck(data['pending_deployments']));
    }
  }

  /// For every deployment the backend still lists as outstanding, tells it
  /// definitively whether this phone has any record of it at all —
  /// currently in flight (ModelDownloader.handleDeploy running now), OR
  /// already a resolved entry in the local model registry/active config
  /// (a real, completed download whose final 'complete' event may simply
  /// never have reached the backend). Only a pending id matching NEITHER
  /// is reported as abandoned.
  ///
  /// The registry check matters: the backend's pending query includes
  /// 'downloaded' deployments, which is also the legitimate resting state
  /// of a deployment that finished successfully but whose terminal event
  /// was lost — treating everything not currently *in flight* as
  /// abandoned would have wrongly killed exactly those already-successful
  /// deployments the durable-reconciliation fix exists to protect.
  Future<void> _handleStateAck(dynamic pending) async {
    // ignore: avoid_print
    print('VERIFICATION: ws -> state_ack pending=$pending');
    if (pending is! List || pending.isEmpty) return;

    final knownIds = <String>{};
    try {
      final active = await ConfigReader.load();
      if (active.config != null && active.config!.deploymentId.isNotEmpty) {
        knownIds.add(active.config!.deploymentId);
      }
      final installed = await ConfigReader.loadInstalled();
      for (final model in installed) {
        if (model.deploymentId.isNotEmpty) knownIds.add(model.deploymentId);
      }
    } catch (e) {
      // Registry unreadable: do not report ANY pending deployment as
      // abandoned on unreliable local state — fail closed and let the
      // existing backend staleness timeout resolve it instead of risking a
      // false-positive failure of a real, working deployment.
      // ignore: avoid_print
      print('VERIFICATION: ws -> state_ack registry read failed, skipping: $e');
      return;
    }

    for (final entry in pending) {
      if (entry is! Map) continue;
      final pendingId = entry['deployment_id'] as String?;
      if (pendingId == null || pendingId.isEmpty) continue;
      if (ModelDownloader.isInFlight(pendingId)) continue;
      if (knownIds.contains(pendingId)) continue;
      send({
        'deployment_id': pendingId,
        'status': 'failed',
        'progress_percent': 0,
        'error_message':
            'Device has no record of this deployment (not in flight, not in '
            'the local registry, after reconnect/restart) — releasing the '
            'stale lease.',
        'error_code': 'DEPLOYMENT_ABANDONED_ON_DEVICE',
      });
    }
  }

  Future<void> _handleDeployment(Map<String, dynamic> data) async {
    await ModelDownloader.handleDeploy(data, send);
    deploymentRevision.value += 1;
    await _sendStateReport();
  }
}
