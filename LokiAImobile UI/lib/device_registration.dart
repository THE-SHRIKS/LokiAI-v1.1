import 'dart:convert';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'pairing_screen.dart';

/// Hardware specs the phone reads about itself (v3: no ADB, the app is the
/// source of truth for its own hardware).
class DeviceSpecs {
  final String phoneModel;
  final String cpuArch;
  final int ramMb;
  final double storageFreeGb;
  final String androidVersion;

  const DeviceSpecs({
    required this.phoneModel,
    required this.cpuArch,
    required this.ramMb,
    required this.storageFreeGb,
    required this.androidVersion,
  });

  Map<String, dynamic> toJson() => {
        'phone_model': phoneModel,
        'cpu_arch': cpuArch,
        'ram_mb': ramMb,
        'storage_free_gb': storageFreeGb,
        'android_version': androidVersion,
      };
}

class RegistrationResult {
  final String? deviceId;
  final String? websocketUrl;
  final String? error; // null = success

  const RegistrationResult({this.deviceId, this.websocketUrl, this.error});

  bool get ok => error == null;
}

class DeviceRegistration {
  static const String prefsDeviceId = 'device_id';
  static const String prefsBackendUrl = 'backend_url';
  static const String prefsWebsocketUrl = 'websocket_url';

  /// Reads the phone's own hardware specs via Flutter platform APIs.
  static Future<DeviceSpecs> readOwnSpecs() async {
    final info = await DeviceInfoPlugin().androidInfo;
    final specs = DeviceSpecs(
      phoneModel: info.model,
      cpuArch: info.supportedAbis.isNotEmpty
          ? info.supportedAbis.first
          : 'unknown',
      ramMb: info.physicalRamSize,
      storageFreeGb: double.parse(
          (info.freeDiskSize / (1024 * 1024 * 1024)).toStringAsFixed(2)),
      androidVersion: info.version.release,
    );
    // ignore: avoid_print
    print('VERIFICATION: self_specs -> ${jsonEncode(specs.toJson())}');
    return specs;
  }

  /// POST /devices/pair with the pairing token + own specs.
  /// On success saves device_id, backend_url and websocket_url to
  /// SharedPreferences so later launches skip the QR scanner.
  static Future<RegistrationResult> register(PairingQrData qr) async {
    final DeviceSpecs specs;
    try {
      specs = await readOwnSpecs();
    } catch (e) {
      return RegistrationResult(
          error: 'Could not read device specs: $e');
    }

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final uri = Uri.parse('${qr.backendUrl}/devices/pair');
      final request = await client.postUrl(uri);
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode({'token': qr.token, ...specs.toJson()}));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      // ignore: avoid_print
      print('VERIFICATION: devices_pair -> '
          'status=${response.statusCode} body=$body');

      if (response.statusCode == 200) {
        final json = jsonDecode(body) as Map<String, dynamic>;
        final deviceId = json['device_id'] as String?;
        final websocketUrl = json['websocket_url'] as String?;
        if (deviceId == null || deviceId.isEmpty) {
          return const RegistrationResult(
              error: 'Backend returned no device_id. Try again.');
        }
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(prefsDeviceId, deviceId);
        await prefs.setString(prefsBackendUrl, qr.backendUrl);
        if (websocketUrl != null && websocketUrl.isNotEmpty) {
          await prefs.setString(prefsWebsocketUrl, websocketUrl);
        }
        return RegistrationResult(
            deviceId: deviceId, websocketUrl: websocketUrl);
      }
      if (response.statusCode == 400) {
        return const RegistrationResult(
            error: 'This code has expired or was already used. '
                'Generate a new one from the dashboard.');
      }
      return RegistrationResult(
          error: 'Pairing failed (${response.statusCode}): $body');
    } on SocketException catch (e) {
      return RegistrationResult(
          error: 'Could not reach ${qr.backendUrl} — ${e.message}. '
              'Check that the phone and the backend are on the same network.');
    } on HttpException catch (e) {
      return RegistrationResult(error: 'HTTP error while pairing: $e');
    } on FormatException catch (e) {
      return RegistrationResult(
          error: 'Backend sent an unreadable response: $e');
    } finally {
      client.close();
    }
  }

  /// True when the app already has saved pairing data.
  static Future<bool> isPaired() async {
    final prefs = await SharedPreferences.getInstance();
    final deviceId = prefs.getString(prefsDeviceId);
    final backendUrl = prefs.getString(prefsBackendUrl);
    return deviceId != null && deviceId.isNotEmpty &&
        backendUrl != null && backendUrl.isNotEmpty;
  }
}
