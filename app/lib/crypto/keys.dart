import 'dart:convert';
import 'package:cryptography/cryptography.dart';

class DeviceKeys {
  final SimpleKeyPair ed25519; // signing / identity
  final SimpleKeyPair x25519;  // Noise IK key exchange

  DeviceKeys({required this.ed25519, required this.x25519});

  static Future<DeviceKeys> generate() async => DeviceKeys(
        ed25519: await Ed25519().newKeyPair(),
        x25519: await X25519().newKeyPair(),
      );

  Future<String> ed25519PubBase64() async =>
      base64Url.encode((await ed25519.extractPublicKey()).bytes);

  Future<String> x25519PubBase64() async =>
      base64Url.encode((await x25519.extractPublicKey()).bytes);
}
