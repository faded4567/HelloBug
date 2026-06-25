import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:hellobug/crypto/noise_ik.dart';
import 'package:hellobug/crypto/nonce_counter.dart';
import 'package:hellobug/crypto/pairing_sas.dart';
import 'package:hellobug/crypto/session_cipher.dart';

void main() {
  final fixture = _loadFixture();

  group('NoiseIk', () {
    test('preserves staged static directional session keys', () async {
      final noise = NoiseIk();
      final initiator = await noise.deriveSessionKeys(
        localStaticPriv: _decodeBase64Url(
          fixture.handshake.initiatorStaticSeed,
        ),
        remoteStaticPub: _decodeBase64Url(fixture.handshake.responderStaticPub),
        role: NoiseRole.initiator,
      );
      final responder = await noise.deriveSessionKeys(
        localStaticPriv: _decodeBase64Url(
          fixture.handshake.responderStaticSeed,
        ),
        remoteStaticPub: _decodeBase64Url(fixture.handshake.initiatorStaticPub),
        role: NoiseRole.responder,
      );

      expect(
        _encodeHex(initiator.sendKey),
        fixture.stagedStatic.initiatorSendKey,
      );
      expect(
        _encodeHex(initiator.recvKey),
        fixture.stagedStatic.initiatorRecvKey,
      );
      expect(
        _encodeHex(responder.sendKey),
        fixture.stagedStatic.responderSendKey,
      );
      expect(
        _encodeHex(responder.recvKey),
        fixture.stagedStatic.responderRecvKey,
      );
    });

    test('runs the deterministic 2-message Noise IK transcript', () async {
      final noise = NoiseIk();
      final initiated = await noise.initiateHandshake(
        localStaticPriv: _decodeBase64Url(
          fixture.handshake.initiatorStaticSeed,
        ),
        localStaticPub: _decodeBase64Url(fixture.handshake.initiatorStaticPub),
        remoteStaticPub: _decodeBase64Url(fixture.handshake.responderStaticPub),
        localEphemeralPriv: _decodeBase64Url(
          fixture.handshake.initiatorEphemeralSeed,
        ),
      );

      expect(
        _encodeBase64Url(initiated.localEphemeralPublicKey),
        fixture.handshake.initiatorEphemeralPub,
      );
      expect(_encodeBase64Url(initiated.message), fixture.handshake.message1);
      expect(
        _encodeHex(initiated.state.handshakeHash),
        fixture.handshake.initiatorHandshakeHash,
      );

      final responded = await noise.respondHandshake(
        localStaticPriv: _decodeBase64Url(
          fixture.handshake.responderStaticSeed,
        ),
        localStaticPub: _decodeBase64Url(fixture.handshake.responderStaticPub),
        remoteStaticPub: _decodeBase64Url(fixture.handshake.initiatorStaticPub),
        localEphemeralPriv: _decodeBase64Url(
          fixture.handshake.responderEphemeralSeed,
        ),
        message: initiated.message,
      );

      expect(
        _encodeBase64Url(responded.localEphemeralPublicKey),
        fixture.handshake.responderEphemeralPub,
      );
      expect(_encodeBase64Url(responded.message), fixture.handshake.message2);
      expect(
        _encodeHex(responded.state.handshakeHash),
        fixture.handshake.responderHandshakeHash,
      );
      expect(
        _encodeHex(responded.pairingHandshakeHash),
        fixture.handshake.initiatorHandshakeHash,
      );
      expect(await derivePairingSas(responded.pairingHandshakeHash), const [
        '🌊',
        '🌊',
        '🐢',
        '🔥',
        '🍵',
      ]);
      expect(_encodeHex(responded.sendKey), fixture.handshake.responderSendKey);
      expect(_encodeHex(responded.recvKey), fixture.handshake.responderRecvKey);

      final completed = await noise.completeHandshake(
        localStaticPriv: _decodeBase64Url(
          fixture.handshake.initiatorStaticSeed,
        ),
        localEphemeralPriv: _decodeBase64Url(
          fixture.handshake.initiatorEphemeralSeed,
        ),
        remoteStaticPub: _decodeBase64Url(fixture.handshake.responderStaticPub),
        state: initiated.state,
        message: responded.message,
      );

      expect(
        _encodeHex(completed.state.handshakeHash),
        fixture.handshake.finalHandshakeHash,
      );
      expect(_encodeHex(completed.sendKey), fixture.handshake.initiatorSendKey);
      expect(_encodeHex(completed.recvKey), fixture.handshake.initiatorRecvKey);
    });

    test('matches the shared AEAD and ratchet fixtures', () async {
      final initiatorCipher = SessionCipher(
        sendKey: _decodeHex(fixture.handshake.initiatorSendKey),
        recvKey: _decodeHex(fixture.handshake.initiatorRecvKey),
      );
      final responderCipher = SessionCipher(
        sendKey: _decodeHex(fixture.handshake.responderSendKey),
        recvKey: _decodeHex(fixture.handshake.responderRecvKey),
      );
      final nonce = _decodeHex(fixture.aead.nonce);
      final plaintext = Uint8List.fromList(
        utf8.encode(fixture.aead.plaintextUtf8),
      );

      final ciphertext = await initiatorCipher.encrypt(plaintext, nonce);

      expect(_encodeHex(ciphertext), fixture.aead.ciphertextHex);
      expect(
        utf8.decode(await responderCipher.decrypt(ciphertext, nonce)),
        fixture.aead.plaintextUtf8,
      );

      final ratchetKeys = await NoiseIk().deriveSessionKeys(
        localStaticPriv: _decodeBase64Url(fixture.ratchet.initiatorNextSeed),
        remoteStaticPub: _decodeBase64Url(fixture.handshake.responderStaticPub),
        role: NoiseRole.initiator,
      );

      expect(_encodeHex(ratchetKeys.sendKey), fixture.ratchet.initiatorSendKey);
      expect(_encodeHex(ratchetKeys.recvKey), fixture.ratchet.initiatorRecvKey);
      expect(
        _encodeHex(
          await NonceCounter(
            fixture.ratchet.sessionId,
          ).fromCounter(fixture.ratchet.counter),
        ),
        fixture.ratchet.nonceHex,
      );
    });
  });
}

_NoiseFixture _loadFixture() {
  final candidates = <String>[
    '../fixtures/noise_ik_fixture.json',
    'fixtures/noise_ik_fixture.json',
  ];
  for (final candidate in candidates) {
    final file = File(candidate);
    if (file.existsSync()) {
      final decoded =
          jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      return _NoiseFixture.fromJson(decoded);
    }
  }
  throw StateError('noise fixture not found');
}

Uint8List _decodeBase64Url(String encoded) =>
    Uint8List.fromList(base64Url.decode(base64Url.normalize(encoded)));

Uint8List _decodeHex(String hex) {
  final bytes = <int>[];
  for (var index = 0; index < hex.length; index += 2) {
    bytes.add(int.parse(hex.substring(index, index + 2), radix: 16));
  }
  return Uint8List.fromList(bytes);
}

String _encodeBase64Url(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

String _encodeHex(List<int> bytes) =>
    bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();

class _NoiseFixture {
  const _NoiseFixture({
    required this.handshake,
    required this.aead,
    required this.ratchet,
    required this.stagedStatic,
  });

  factory _NoiseFixture.fromJson(Map<String, dynamic> json) => _NoiseFixture(
    handshake: _HandshakeFixture.fromJson(
      json['handshake'] as Map<String, dynamic>,
    ),
    aead: _AeadFixture.fromJson(json['aead'] as Map<String, dynamic>),
    ratchet: _RatchetFixture.fromJson(json['ratchet'] as Map<String, dynamic>),
    stagedStatic: _StagedStaticFixture.fromJson(
      json['staged_static'] as Map<String, dynamic>,
    ),
  );

  final _HandshakeFixture handshake;
  final _AeadFixture aead;
  final _RatchetFixture ratchet;
  final _StagedStaticFixture stagedStatic;
}

class _HandshakeFixture {
  const _HandshakeFixture({
    required this.initiatorStaticSeed,
    required this.initiatorStaticPub,
    required this.responderStaticSeed,
    required this.responderStaticPub,
    required this.initiatorEphemeralSeed,
    required this.initiatorEphemeralPub,
    required this.responderEphemeralSeed,
    required this.responderEphemeralPub,
    required this.message1,
    required this.message2,
    required this.initiatorHandshakeHash,
    required this.responderHandshakeHash,
    required this.finalHandshakeHash,
    required this.initiatorSendKey,
    required this.initiatorRecvKey,
    required this.responderSendKey,
    required this.responderRecvKey,
  });

  factory _HandshakeFixture.fromJson(Map<String, dynamic> json) =>
      _HandshakeFixture(
        initiatorStaticSeed: json['initiator_static_seed'] as String,
        initiatorStaticPub: json['initiator_static_pub'] as String,
        responderStaticSeed: json['responder_static_seed'] as String,
        responderStaticPub: json['responder_static_pub'] as String,
        initiatorEphemeralSeed: json['initiator_ephemeral_seed'] as String,
        initiatorEphemeralPub: json['initiator_ephemeral_pub'] as String,
        responderEphemeralSeed: json['responder_ephemeral_seed'] as String,
        responderEphemeralPub: json['responder_ephemeral_pub'] as String,
        message1: json['message_1'] as String,
        message2: json['message_2'] as String,
        initiatorHandshakeHash: json['initiator_handshake_hash'] as String,
        responderHandshakeHash: json['responder_handshake_hash'] as String,
        finalHandshakeHash: json['final_handshake_hash'] as String,
        initiatorSendKey: json['initiator_send_key'] as String,
        initiatorRecvKey: json['initiator_recv_key'] as String,
        responderSendKey: json['responder_send_key'] as String,
        responderRecvKey: json['responder_recv_key'] as String,
      );

  final String initiatorStaticSeed;
  final String initiatorStaticPub;
  final String responderStaticSeed;
  final String responderStaticPub;
  final String initiatorEphemeralSeed;
  final String initiatorEphemeralPub;
  final String responderEphemeralSeed;
  final String responderEphemeralPub;
  final String message1;
  final String message2;
  final String initiatorHandshakeHash;
  final String responderHandshakeHash;
  final String finalHandshakeHash;
  final String initiatorSendKey;
  final String initiatorRecvKey;
  final String responderSendKey;
  final String responderRecvKey;
}

class _AeadFixture {
  const _AeadFixture({
    required this.nonce,
    required this.plaintextUtf8,
    required this.ciphertextHex,
  });

  factory _AeadFixture.fromJson(Map<String, dynamic> json) => _AeadFixture(
    nonce: json['nonce'] as String,
    plaintextUtf8: json['plaintext_utf8'] as String,
    ciphertextHex: json['ciphertext_hex'] as String,
  );

  final String nonce;
  final String plaintextUtf8;
  final String ciphertextHex;
}

class _RatchetFixture {
  const _RatchetFixture({
    required this.sessionId,
    required this.counter,
    required this.nonceHex,
    required this.initiatorNextSeed,
    required this.initiatorSendKey,
    required this.initiatorRecvKey,
  });

  factory _RatchetFixture.fromJson(Map<String, dynamic> json) =>
      _RatchetFixture(
        sessionId: json['session_id'] as String,
        counter: json['counter'] as int,
        nonceHex: json['nonce_hex'] as String,
        initiatorNextSeed: json['initiator_next_seed'] as String,
        initiatorSendKey: json['initiator_send_key'] as String,
        initiatorRecvKey: json['initiator_recv_key'] as String,
      );

  final String sessionId;
  final int counter;
  final String nonceHex;
  final String initiatorNextSeed;
  final String initiatorSendKey;
  final String initiatorRecvKey;
}

class _StagedStaticFixture {
  const _StagedStaticFixture({
    required this.initiatorSendKey,
    required this.initiatorRecvKey,
    required this.responderSendKey,
    required this.responderRecvKey,
  });

  factory _StagedStaticFixture.fromJson(Map<String, dynamic> json) =>
      _StagedStaticFixture(
        initiatorSendKey: json['initiator_send_key'] as String,
        initiatorRecvKey: json['initiator_recv_key'] as String,
        responderSendKey: json['responder_send_key'] as String,
        responderRecvKey: json['responder_recv_key'] as String,
      );

  final String initiatorSendKey;
  final String initiatorRecvKey;
  final String responderSendKey;
  final String responderRecvKey;
}
