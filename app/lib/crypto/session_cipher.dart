import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

// ChaCha20-Poly1305 AEAD with directional session keys.
class SessionCipher {
  static final Chacha20 _algorithm = Chacha20.poly1305Aead();
  static const _keyLength = 32;
  static const _nonceLength = 12;
  static const _macLength = 16;

  final Uint8List sendKey;
  final Uint8List recvKey;

  SessionCipher({required Uint8List sendKey, required Uint8List recvKey})
    : sendKey = _copyAndValidateKey('sendKey', sendKey),
      recvKey = _copyAndValidateKey('recvKey', recvKey);

  Future<Uint8List> encrypt(Uint8List plaintext, Uint8List nonce) async {
    final safeNonce = _validateNonce(nonce);
    final secretBox = await _algorithm.encrypt(
      plaintext,
      secretKey: SecretKey(sendKey),
      nonce: safeNonce,
    );
    return Uint8List.fromList(secretBox.concatenation(nonce: false, mac: true));
  }

  Future<Uint8List> decrypt(Uint8List ciphertext, Uint8List nonce) async {
    final safeNonce = _validateNonce(nonce);
    if (ciphertext.length < _macLength) {
      throw const FormatException('ciphertext is too short');
    }

    final sealedBox = SecretBox.fromConcatenation(
      ciphertext,
      nonceLength: 0,
      macLength: _macLength,
    );
    final plaintext = await _algorithm.decrypt(
      SecretBox(sealedBox.cipherText, nonce: safeNonce, mac: sealedBox.mac),
      secretKey: SecretKey(recvKey),
    );
    return Uint8List.fromList(plaintext);
  }

  static Uint8List _copyAndValidateKey(String label, Uint8List key) {
    if (key.length != _keyLength) {
      throw FormatException('$label must be $_keyLength bytes');
    }
    return Uint8List.fromList(key);
  }

  static Uint8List _validateNonce(Uint8List nonce) {
    if (nonce.length != _nonceLength) {
      throw const FormatException('nonce must be 12 bytes');
    }
    return Uint8List.fromList(nonce);
  }
}
