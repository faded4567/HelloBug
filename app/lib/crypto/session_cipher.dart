import 'dart:typed_data';

// Stub — gated on Spike F1.
// ChaCha20-Poly1305 AEAD with session keys derived from Noise IK.
class SessionCipher {
  final Uint8List sendKey;
  final Uint8List recvKey;

  const SessionCipher({required this.sendKey, required this.recvKey});

  Future<Uint8List> encrypt(Uint8List plaintext, Uint8List nonce) =>
      throw UnimplementedError('Spike F1 required.');

  Future<Uint8List> decrypt(Uint8List ciphertext, Uint8List nonce) =>
      throw UnimplementedError('Spike F1 required.');
}
