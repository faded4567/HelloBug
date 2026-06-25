import 'package:flutter_secure_storage/flutter_secure_storage.dart';

// Wraps FlutterSecureStorage with consistent iOS/Android options.
// iOS: accessible after first unlock (allows background key reads).
// Android: encrypted shared prefs.
class SecureStore {
  static const _s = FlutterSecureStorage(
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const keyEd25519Private = 'device.ed25519.private';
  static const keyX25519Private = 'device.x25519.private';
  static const keyServerPin = 'server.pin';
  static const keyJwt = 'app.jwt';
  static const keyPairedDeviceId = 'paired.device_id';
  static const keyPairedDaemonId = 'paired.daemon_id';
  static const keyPairedDaemonPubKey = 'paired.daemon_pubkey';
  static const keyPairedDaemonEd25519PubKey = 'paired.daemon_ed25519_pubkey';
  static const keyPairedTransportSendKey = 'paired.transport_send_key';
  static const keyPairedTransportRecvKey = 'paired.transport_recv_key';
  static const keyServerUrl = 'server.url';
  static const keyAppInstanceId = 'app.instance_id';
  static const keyPairedMachineName = 'paired.machine_name';
  static const keyPairedOs = 'paired.os';

  static Future<void> write(String key, String value) =>
      _s.write(key: key, value: value);

  static Future<String?> read(String key) => _s.read(key: key);

  static Future<void> delete(String key) => _s.delete(key: key);

  static Future<bool> contains(String key) => _s.containsKey(key: key);
}
