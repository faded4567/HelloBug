import 'dart:convert';

import 'package:cryptography/cryptography.dart';

import 'secure_store.dart';

class DeviceKeys {
  final SimpleKeyPair ed25519; // signing / identity
  final SimpleKeyPair x25519; // Noise IK key exchange

  DeviceKeys({required this.ed25519, required this.x25519});

  static const _seedLength = 32;

  static Future<DeviceKeys> loadOrCreate() async {
    final storedEd25519 = await SecureStore.read(SecureStore.keyEd25519Private);
    final storedX25519 = await SecureStore.read(SecureStore.keyX25519Private);
    if (storedEd25519 != null && storedX25519 != null) {
      return DeviceKeys(
        ed25519: await _restoreEd25519(storedEd25519),
        x25519: await _restoreX25519(storedX25519),
      );
    }

    final generated = await generate();
    await generated.persist();
    return generated;
  }

  static Future<DeviceKeys> generate() async => DeviceKeys(
        ed25519: await Ed25519().newKeyPair(),
        x25519: await X25519().newKeyPair(),
      );

  Future<String> ed25519PubBase64() async =>
      base64Url.encode((await ed25519.extractPublicKey()).bytes);

  Future<String> x25519PubBase64() async =>
      base64Url.encode((await x25519.extractPublicKey()).bytes);

  Future<void> persist() async {
    final ed25519Bytes = await ed25519.extractPrivateKeyBytes();
    final x25519Bytes = await x25519.extractPrivateKeyBytes();
    await Future.wait([
      SecureStore.write(
        SecureStore.keyEd25519Private,
        base64Url.encode(ed25519Bytes),
      ),
      SecureStore.write(
        SecureStore.keyX25519Private,
        base64Url.encode(x25519Bytes),
      ),
    ]);
  }

  static Future<SimpleKeyPair> _restoreEd25519(String encoded) async {
    final seed = base64Url.decode(base64Url.normalize(encoded));
    if (seed.length != _seedLength) {
      throw const FormatException('Invalid stored Ed25519 seed length');
    }
    return Ed25519().newKeyPairFromSeed(seed);
  }

  static Future<SimpleKeyPair> _restoreX25519(String encoded) async {
    final seed = base64Url.decode(base64Url.normalize(encoded));
    if (seed.length != _seedLength) {
      throw const FormatException('Invalid stored X25519 seed length');
    }
    return X25519().newKeyPairFromSeed(seed);
  }
}
