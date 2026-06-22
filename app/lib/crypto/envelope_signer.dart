import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

// Signs/verifies the Envelope routing fields to prevent relay tampering.
// Signature covers: from + to + session_id + seq + ts (UTF-8 concatenation).
class EnvelopeSigner {
  final SimpleKeyPair _kp;
  final _algo = Ed25519();

  EnvelopeSigner(this._kp);

  Future<String> sign(String from, String to, String sessionId, int seq, int ts) async {
    final sig = await _algo.sign(
      utf8.encode('$from$to$sessionId$seq$ts'),
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
    required String sigBase64,
    required SimplePublicKey pubKey,
  }) async {
    return _algo.verify(
      utf8.encode('$from$to$sessionId$seq$ts'),
      signature: Signature(base64Url.decode(sigBase64), publicKey: pubKey),
    );
  }
}
