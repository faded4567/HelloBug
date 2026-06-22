import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

// Maintains the 12-byte nonce per protocol spec:
//   bytes[0..3] = SHA-256(sessionId)[0..3]
//   bytes[4..11] = uint64 big-endian message counter (from 0)
// Counter resets to 0 on key ratchet.
class NonceCounter {
  final String sessionId;
  int _counter = 0;
  Uint8List? _prefix;

  NonceCounter(this.sessionId);

  Future<Uint8List> next() async {
    _prefix ??= Uint8List.fromList(
      (await Sha256().hash(utf8.encode(sessionId))).bytes.sublist(0, 4),
    );
    final buf  = Uint8List(12);
    final data = ByteData.sublistView(buf);
    buf.setRange(0, 4, _prefix!);
    data.setUint32(4, (_counter >> 32) & 0xFFFFFFFF);
    data.setUint32(8,  _counter       & 0xFFFFFFFF);
    _counter++;
    return buf;
  }

  void reset() => _counter = 0;
}
