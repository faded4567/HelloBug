import 'dart:typed_data';

// Stub — full implementation gated on Spike F1 (cross-platform Noise IK fixture).
// Spike must confirm that Dart and Node derive identical session keys before
// this class is implemented.
abstract class NoiseIk {
  // Returns (sendKey, recvKey) after the 2-message Noise IK handshake.
  Future<({Uint8List sendKey, Uint8List recvKey})> initiate({
    required Uint8List localStaticPriv,
    required Uint8List remoteStaticPub,
  });

  Future<({Uint8List sendKey, Uint8List recvKey, Uint8List response})> respond({
    required Uint8List localStaticPriv,
    required Uint8List initiatorMessage,
  });
}
