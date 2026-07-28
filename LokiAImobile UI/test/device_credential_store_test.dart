import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lokiai_app/device_credential_store.dart';

/// The device token is a bearer credential for this phone's WebSocket. These
/// tests pin the behaviour that matters for that: it must not be left sitting
/// in plaintext shared_preferences, and clearing it must actually clear it.
///
/// flutter_secure_storage talks to the Android Keystore over a platform
/// channel, which does not exist in a unit-test binding, so the channel is
/// faked here with an in-memory map. That is enough to verify the store's own
/// logic (migration, precedence, deletion); it does not — and cannot — prove
/// that the real Keystore is used on a device. That part is covered by the
/// on-device checklist in the real-device validation report.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  late Map<String, String> fakeKeystore;

  setUp(() {
    fakeKeystore = <String, String>{};
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
      final args = (call.arguments as Map?)?.cast<String, dynamic>() ?? {};
      final key = args['key'] as String?;
      switch (call.method) {
        case 'write':
          fakeKeystore[key!] = args['value'] as String;
          return null;
        case 'read':
          return fakeKeystore[key];
        case 'delete':
          fakeKeystore.remove(key);
          return null;
        case 'readAll':
          return fakeKeystore;
        case 'deleteAll':
          fakeKeystore.clear();
          return null;
        case 'containsKey':
          return fakeKeystore.containsKey(key);
      }
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('write stores the token and leaves no plaintext copy', () async {
    SharedPreferences.setMockInitialValues({});
    await DeviceCredentialStore.write('device-token-abc');

    expect(fakeKeystore[DeviceCredentialStore.legacyPrefsKey],
        'device-token-abc');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(DeviceCredentialStore.legacyPrefsKey), isNull,
        reason: 'the credential must never remain in plaintext prefs');
  });

  test('read returns null when nothing is stored', () async {
    SharedPreferences.setMockInitialValues({});
    expect(await DeviceCredentialStore.read(), isNull);
    expect(await DeviceCredentialStore.hasCredential(), isFalse);
  });

  test('migrates a legacy plaintext token and deletes the original', () async {
    // Simulates an install from a build that predates secure storage.
    SharedPreferences.setMockInitialValues({
      DeviceCredentialStore.legacyPrefsKey: 'legacy-token-xyz',
    });

    final token = await DeviceCredentialStore.read();
    expect(token, 'legacy-token-xyz',
        reason: 'migration must not lose the credential (no forced re-pair)');

    expect(fakeKeystore[DeviceCredentialStore.legacyPrefsKey],
        'legacy-token-xyz',
        reason: 'token should now live in secure storage');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(DeviceCredentialStore.legacyPrefsKey), isNull,
        reason: 'the plaintext copy must be removed, not merely duplicated');
  });

  test('secure value wins over a stale plaintext value', () async {
    SharedPreferences.setMockInitialValues({
      DeviceCredentialStore.legacyPrefsKey: 'stale-plaintext',
    });
    await DeviceCredentialStore.write('current-secure');

    expect(await DeviceCredentialStore.read(), 'current-secure');
  });

  test('clear removes the credential from both locations', () async {
    SharedPreferences.setMockInitialValues({
      DeviceCredentialStore.legacyPrefsKey: 'legacy-token',
    });
    await DeviceCredentialStore.write('secure-token');

    await DeviceCredentialStore.clear();

    expect(fakeKeystore.containsKey(DeviceCredentialStore.legacyPrefsKey),
        isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(DeviceCredentialStore.legacyPrefsKey), isNull);
    expect(await DeviceCredentialStore.hasCredential(), isFalse);
  });
}
