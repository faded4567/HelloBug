import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

Uint8List _signaturePayload(
  String from,
  String to,
  String sessionId,
  int seq,
  int ts,
  String ciphertext,
  String? messageType,
  String? cipherMode,
  String? senderPubkey,
) => Uint8List.fromList(
  utf8.encode(
    jsonEncode([
      from,
      to,
      sessionId,
      seq,
      ts,
      ciphertext,
      messageType ?? '',
      cipherMode ?? '',
      senderPubkey ?? '',
    ]),
  ),
);

// Signs/verifies the Envelope routing fields plus ciphertext to prevent
// relay tampering while the payload is still in the development base64 stub.
class EnvelopeSigner {
  final SimpleKeyPair _kp;
  final _algo = Ed25519();

  EnvelopeSigner(this._kp);

  Future<String> sign(
    String from,
    String to,
    String sessionId,
    int seq,
    int ts,
    String ciphertext, [
    String? messageType,
    String? cipherMode,
    String? senderPubkey,
  ]) async {
    final sig = await _algo.sign(
      _signaturePayload(
        from,
        to,
        sessionId,
        seq,
        ts,
        ciphertext,
        messageType,
        cipherMode,
        senderPubkey,
      ),
      keyPair: _kp,
    );
    return base64Url.encode(Uint8List.fromList(sig.bytes));
  }

  Future<bool> verify({
    required String from,
    required String to,
    required String sessionId,
    required int seq,
    required int ts,
    required String ciphertext,
    String? messageType,
    String? cipherMode,
    String? senderPubkey,
    required String sigBase64,
    required SimplePublicKey pubKey,
  }) async {
    return _algo.verify(
      _signaturePayload(
        from,
        to,
        sessionId,
        seq,
        ts,
        ciphertext,
        messageType,
        cipherMode,
        senderPubkey,
      ),
      signature: Signature(
        base64Url.decode(base64Url.normalize(sigBase64)),
        publicKey: pubKey,
      ),
    );
  }
}
