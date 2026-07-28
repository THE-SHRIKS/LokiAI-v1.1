import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Keystore-backed storage for the device WebSocket credential.
///
/// The token issued by `POST /devices/pair` is a real bearer credential: it is
/// what proves to the backend that this process is that specific paired phone.
/// It was originally written to `shared_preferences`, which on Android is a
/// plain XML file in the app sandbox — readable on a rooted device, and
/// eligible for Android cloud backup, meaning a restore onto a different
/// handset could carry a working device identity with it.
///
/// This store keeps the token in `EncryptedSharedPreferences`, whose key
/// material lives in the Android Keystore. Non-secret pairing data
/// (`device_id`, `backend_url`, `websocket_url`) deliberately stays in
/// ordinary shared_preferences — it is not sensitive and other call sites read
/// it synchronously at startup.
///
/// Never log the value returned by [read]. Only ever log whether one is
/// present.
class DeviceCredentialStore {
  DeviceCredentialStore._();

  static const String _secureKey = 'device_token';

  /// The pre-hardening plaintext location. Only ever read, to migrate away
  /// from, then deleted.
  static const String legacyPrefsKey = 'device_token';

  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  /// Reads the device token, transparently migrating any value left in the old
  /// plaintext location by a build that predates this store.
  ///
  /// Migration is one-way and destructive on the legacy side by design: once
  /// the value is safely in the Keystore-backed store, leaving a plaintext
  /// copy behind would defeat the entire change.
  static Future<String?> read() async {
    try {
      final secure = await _storage.read(key: _secureKey);
      if (secure != null && secure.isNotEmpty) return secure;
    } catch (e) {
      // A Keystore failure must not brick pairing — fall through to the legacy
      // read so the device can still connect, and report it.
      // ignore: avoid_print
      print('VERIFICATION: cred_store -> secure read failed: $e');
    }

    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString(legacyPrefsKey);
    if (legacy == null || legacy.isEmpty) return null;

    // ignore: avoid_print
    print('VERIFICATION: cred_store -> migrating device token to secure storage');
    try {
      await _storage.write(key: _secureKey, value: legacy);
      await prefs.remove(legacyPrefsKey);
    } catch (e) {
      // Keep the legacy copy if the secure write failed; losing the token
      // would force an unnecessary re-pair.
      // ignore: avoid_print
      print('VERIFICATION: cred_store -> migration failed, keeping legacy: $e');
    }
    return legacy;
  }

  /// Stores the token issued at pairing.
  static Future<void> write(String token) async {
    await _storage.write(key: _secureKey, value: token);
    // Defensive: ensure no plaintext copy survives from an earlier build.
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(legacyPrefsKey);
  }

  /// Removes the credential. Called on unpair and whenever the backend tells
  /// us the token is no longer valid.
  static Future<void> clear() async {
    try {
      await _storage.delete(key: _secureKey);
    } catch (e) {
      // ignore: avoid_print
      print('VERIFICATION: cred_store -> secure delete failed: $e');
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(legacyPrefsKey);
  }

  /// True when a credential is present. Never returns the value itself.
  static Future<bool> hasCredential() async {
    final token = await read();
    return token != null && token.isNotEmpty;
  }
}
