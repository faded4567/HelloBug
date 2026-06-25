import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

enum NoiseRole { initiator, responder }

class NoiseHandshakeState {
  const NoiseHandshakeState({
    required this.chainingKey,
    required this.handshakeHash,
  });

  final Uint8List chainingKey;
  final Uint8List handshakeHash;
}

class InitiatedNoiseHandshake {
  const InitiatedNoiseHandshake({
    required this.state,
    required this.localEphemeralPublicKey,
    required this.message,
  });

  final NoiseHandshakeState state;
  final Uint8List localEphemeralPublicKey;
  final Uint8List message;
}

class RespondedNoiseHandshake {
  const RespondedNoiseHandshake({
    required this.state,
    required this.pairingHandshakeHash,
    required this.localEphemeralPublicKey,
    required this.message,
    required this.sendKey,
    required this.recvKey,
  });

  final NoiseHandshakeState state;
  final Uint8List pairingHandshakeHash;
  final Uint8List localEphemeralPublicKey;
  final Uint8List message;
  final Uint8List sendKey;
  final Uint8List recvKey;
}

class CompletedNoiseHandshake {
  const CompletedNoiseHandshake({
    required this.state,
    required this.sendKey,
    required this.recvKey,
  });

  final NoiseHandshakeState state;
  final Uint8List sendKey;
  final Uint8List recvKey;
}

class NoiseIk {
  NoiseIk({X25519? x25519, Hkdf? hkdf, Sha256? sha256, Chacha20? aead})
    : _x25519 = x25519 ?? X25519(),
      _hkdf = hkdf ?? Hkdf(hmac: Hmac.sha256(), outputLength: _sessionKeyBytes),
      _sha256 = sha256 ?? Sha256(),
      _aead = aead ?? Chacha20.poly1305Aead();

  static const _staticSaltLabel = 'hellobug-noise-static-salt-v1';
  static const _hkdfInfo = 'hellobug-noise-static-v1';
  static const _noiseProtocolName = 'Noise_IK_HelloBug_25519_ChaChaPoly_SHA256';
  static const _privateKeyLength = 32;
  static const _publicKeyLength = 32;
  static const _directionalKeyLength = 32;
  static const _sessionKeyBytes = _directionalKeyLength * 2;
  static final Uint8List _zeroNonce = Uint8List(12);
  static final Uint8List _emptyInfo = Uint8List(0);

  final X25519 _x25519;
  final Hkdf _hkdf;
  final Sha256 _sha256;
  final Chacha20 _aead;

  Future<InitiatedNoiseHandshake> initiateHandshake({
    required Uint8List localStaticPriv,
    required Uint8List localStaticPub,
    required Uint8List remoteStaticPub,
    Uint8List? localEphemeralPriv,
  }) async {
    final localStatic = await _restoreKeyPair(localStaticPriv);
    final localEphemeral =
        localEphemeralPriv == null
            ? await _generateKeyPair()
            : await _restoreKeyPair(localEphemeralPriv);
    final safeLocalStaticPub = _parsePublicKey(localStaticPub);
    final safeRemoteStaticPub = _parsePublicKey(remoteStaticPub);
    final safeLocalEphemeralPub = Uint8List.fromList(
      localEphemeral.publicKey.bytes,
    );

    var state = await _initializeSymmetricState();
    state = await _mixHash(state, safeRemoteStaticPub);
    state = await _mixHash(state, safeLocalEphemeralPub);
    state = await _mixKey(
      state,
      await _dh(localEphemeral.keyPair, safeRemoteStaticPub),
    );
    final encryptedStatic = await _encryptAndHash(state, safeLocalStaticPub);
    state = encryptedStatic.state;
    state = await _mixKey(
      state,
      await _dh(localStatic.keyPair, safeRemoteStaticPub),
    );

    return InitiatedNoiseHandshake(
      state: _snapshotState(state),
      localEphemeralPublicKey: safeLocalEphemeralPub,
      message: Uint8List.fromList([
        ...safeLocalEphemeralPub,
        ...encryptedStatic.ciphertext,
      ]),
    );
  }

  Future<RespondedNoiseHandshake> respondHandshake({
    required Uint8List localStaticPriv,
    required Uint8List localStaticPub,
    required Uint8List remoteStaticPub,
    required Uint8List message,
    Uint8List? localEphemeralPriv,
  }) async {
    final localStatic = await _restoreKeyPair(localStaticPriv);
    final localEphemeral =
        localEphemeralPriv == null
            ? await _generateKeyPair()
            : await _restoreKeyPair(localEphemeralPriv);
    final safeLocalStaticPub = _parsePublicKey(localStaticPub);
    final safeRemoteStaticPub = _parsePublicKey(remoteStaticPub);
    final safeMessage = Uint8List.fromList(message);
    if (safeMessage.length != _publicKeyLength + _publicKeyLength + 16) {
      throw const FormatException('invalid initiator handshake message length');
    }

    final initiatorEphemeralPub = _parsePublicKey(
      Uint8List.sublistView(safeMessage, 0, _publicKeyLength),
    );
    final encryptedStatic = Uint8List.sublistView(
      safeMessage,
      _publicKeyLength,
    );
    final safeLocalEphemeralPub = Uint8List.fromList(
      localEphemeral.publicKey.bytes,
    );

    var state = await _initializeSymmetricState();
    state = await _mixHash(state, safeLocalStaticPub);
    state = await _mixHash(state, initiatorEphemeralPub);
    state = await _mixKey(
      state,
      await _dh(localStatic.keyPair, initiatorEphemeralPub),
    );
    final decryptedStatic = await _decryptAndHash(state, encryptedStatic);
    state = decryptedStatic.state;
    final initiatorStaticPub = _parsePublicKey(decryptedStatic.plaintext);
    if (!_bytesEqual(initiatorStaticPub, safeRemoteStaticPub)) {
      throw const FormatException('initiator static public key mismatch');
    }
    state = await _mixKey(
      state,
      await _dh(localStatic.keyPair, initiatorStaticPub),
    );
    final pairingHandshakeHash = Uint8List.fromList(state.handshakeHash);
    state = await _mixHash(state, safeLocalEphemeralPub);
    state = await _mixKey(
      state,
      await _dh(localEphemeral.keyPair, initiatorEphemeralPub),
    );
    state = await _mixKey(
      state,
      await _dh(localEphemeral.keyPair, initiatorStaticPub),
    );

    final keys = await _splitSessionKeys(state, NoiseRole.responder);
    return RespondedNoiseHandshake(
      state: _snapshotState(state),
      pairingHandshakeHash: pairingHandshakeHash,
      localEphemeralPublicKey: safeLocalEphemeralPub,
      message: safeLocalEphemeralPub,
      sendKey: keys.sendKey,
      recvKey: keys.recvKey,
    );
  }

  Future<CompletedNoiseHandshake> completeHandshake({
    required Uint8List localStaticPriv,
    required Uint8List localEphemeralPriv,
    required Uint8List remoteStaticPub,
    required NoiseHandshakeState state,
    required Uint8List message,
  }) async {
    final localStatic = await _restoreKeyPair(localStaticPriv);
    final localEphemeral = await _restoreKeyPair(localEphemeralPriv);
    final responderEphemeralPub = _parsePublicKey(message);
    _parsePublicKey(remoteStaticPub);

    var symmetricState = _resumeSymmetricState(state);
    symmetricState = await _mixHash(symmetricState, responderEphemeralPub);
    symmetricState = await _mixKey(
      symmetricState,
      await _dh(localEphemeral.keyPair, responderEphemeralPub),
    );
    symmetricState = await _mixKey(
      symmetricState,
      await _dh(localStatic.keyPair, responderEphemeralPub),
    );

    final keys = await _splitSessionKeys(symmetricState, NoiseRole.initiator);
    return CompletedNoiseHandshake(
      state: _snapshotState(symmetricState),
      sendKey: keys.sendKey,
      recvKey: keys.recvKey,
    );
  }

  Future<({Uint8List sendKey, Uint8List recvKey})> deriveSessionKeys({
    required Uint8List localStaticPriv,
    required Uint8List remoteStaticPub,
    required NoiseRole role,
  }) async {
    final localKeyPair = await _restoreLocalKeyPair(localStaticPriv);
    return _deriveSessionKeys(
      localKeyPair: localKeyPair,
      localPublicKey: await localKeyPair.extractPublicKey(),
      remoteStaticPublicKey: _parseRemotePublicKey(remoteStaticPub),
      role: role,
    );
  }

  static Uint8List decodePublicKeyBase64Url(String encoded) =>
      Uint8List.fromList(base64Url.decode(base64Url.normalize(encoded)));

  Future<SimpleKeyPair> _restoreLocalKeyPair(Uint8List seed) async {
    if (seed.length != _privateKeyLength) {
      throw FormatException(
        'X25519 private key must be $_privateKeyLength bytes',
      );
    }
    return _x25519.newKeyPairFromSeed(seed);
  }

  Future<({SimpleKeyPair keyPair, SimplePublicKey publicKey})> _restoreKeyPair(
    Uint8List seed,
  ) async {
    final keyPair = await _restoreLocalKeyPair(seed);
    return (keyPair: keyPair, publicKey: await keyPair.extractPublicKey());
  }

  Future<({SimpleKeyPair keyPair, SimplePublicKey publicKey})>
  _generateKeyPair() async {
    final keyPair = await _x25519.newKeyPair();
    return (keyPair: keyPair, publicKey: await keyPair.extractPublicKey());
  }

  Future<({Uint8List sendKey, Uint8List recvKey})> _deriveSessionKeys({
    required SimpleKeyPair localKeyPair,
    required SimplePublicKey localPublicKey,
    required SimplePublicKey remoteStaticPublicKey,
    required NoiseRole role,
  }) async {
    final sharedSecret = await _x25519.sharedSecretKey(
      keyPair: localKeyPair,
      remotePublicKey: remoteStaticPublicKey,
    );
    final initiatorPublicKey =
        role == NoiseRole.initiator
            ? localPublicKey.bytes
            : remoteStaticPublicKey.bytes;
    final responderPublicKey =
        role == NoiseRole.responder
            ? localPublicKey.bytes
            : remoteStaticPublicKey.bytes;
    final salt = await _deriveSalt(
      initiatorPublicKey: initiatorPublicKey,
      responderPublicKey: responderPublicKey,
    );
    final material = await _hkdf.deriveKey(
      secretKey: sharedSecret,
      nonce: salt,
      info: utf8.encode(_hkdfInfo),
    );
    final bytes = await material.extractBytes();
    final initiatorSendKey = Uint8List.fromList(
      bytes.sublist(0, _directionalKeyLength),
    );
    final responderSendKey = Uint8List.fromList(
      bytes.sublist(_directionalKeyLength, _sessionKeyBytes),
    );
    return role == NoiseRole.initiator
        ? (sendKey: initiatorSendKey, recvKey: responderSendKey)
        : (sendKey: responderSendKey, recvKey: initiatorSendKey);
  }

  SimplePublicKey _parseRemotePublicKey(Uint8List bytes) {
    return SimplePublicKey(_parsePublicKey(bytes), type: KeyPairType.x25519);
  }

  Uint8List _parsePublicKey(Uint8List bytes) {
    if (bytes.length != _publicKeyLength) {
      throw FormatException(
        'X25519 public key must be $_publicKeyLength bytes',
      );
    }
    return Uint8List.fromList(bytes);
  }

  Future<Uint8List> _deriveSalt({
    required List<int> initiatorPublicKey,
    required List<int> responderPublicKey,
  }) async {
    final input = Uint8List.fromList([
      ...utf8.encode(_staticSaltLabel),
      ...initiatorPublicKey,
      ...responderPublicKey,
    ]);
    return Uint8List.fromList((await _sha256.hash(input)).bytes);
  }

  Future<_NoiseSymmetricState> _initializeSymmetricState() async {
    final protocolHash = Uint8List.fromList(
      (await _sha256.hash(utf8.encode(_noiseProtocolName))).bytes,
    );
    return _NoiseSymmetricState(
      chainingKey: protocolHash,
      handshakeHash: Uint8List.fromList(protocolHash),
      cipherKey: null,
    );
  }

  _NoiseSymmetricState _resumeSymmetricState(NoiseHandshakeState state) =>
      _NoiseSymmetricState(
        chainingKey: Uint8List.fromList(state.chainingKey),
        handshakeHash: Uint8List.fromList(state.handshakeHash),
        cipherKey: null,
      );

  NoiseHandshakeState _snapshotState(_NoiseSymmetricState state) =>
      NoiseHandshakeState(
        chainingKey: Uint8List.fromList(state.chainingKey),
        handshakeHash: Uint8List.fromList(state.handshakeHash),
      );

  Future<_NoiseSymmetricState> _mixHash(
    _NoiseSymmetricState state,
    Uint8List input,
  ) async {
    final hashInput = Uint8List.fromList([...state.handshakeHash, ...input]);
    return _NoiseSymmetricState(
      chainingKey: Uint8List.fromList(state.chainingKey),
      handshakeHash: Uint8List.fromList((await _sha256.hash(hashInput)).bytes),
      cipherKey:
          state.cipherKey == null ? null : Uint8List.fromList(state.cipherKey!),
    );
  }

  Future<_NoiseSymmetricState> _mixKey(
    _NoiseSymmetricState state,
    Uint8List inputKeyMaterial,
  ) async {
    final material = await _deriveMaterial(
      secret: inputKeyMaterial,
      salt: state.chainingKey,
    );
    return _NoiseSymmetricState(
      chainingKey: Uint8List.fromList(
        material.sublist(0, _directionalKeyLength),
      ),
      handshakeHash: Uint8List.fromList(state.handshakeHash),
      cipherKey: Uint8List.fromList(
        material.sublist(_directionalKeyLength, _sessionKeyBytes),
      ),
    );
  }

  Future<({Uint8List ciphertext, _NoiseSymmetricState state})> _encryptAndHash(
    _NoiseSymmetricState state,
    Uint8List plaintext,
  ) async {
    final ciphertext =
        state.cipherKey == null
            ? Uint8List.fromList(plaintext)
            : await _encryptWithAad(
              plaintext: plaintext,
              key: state.cipherKey!,
              aad: state.handshakeHash,
            );
    return (ciphertext: ciphertext, state: await _mixHash(state, ciphertext));
  }

  Future<({Uint8List plaintext, _NoiseSymmetricState state})> _decryptAndHash(
    _NoiseSymmetricState state,
    Uint8List ciphertext,
  ) async {
    final plaintext =
        state.cipherKey == null
            ? Uint8List.fromList(ciphertext)
            : await _decryptWithAad(
              ciphertext: ciphertext,
              key: state.cipherKey!,
              aad: state.handshakeHash,
            );
    return (plaintext: plaintext, state: await _mixHash(state, ciphertext));
  }

  Future<({Uint8List sendKey, Uint8List recvKey})> _splitSessionKeys(
    _NoiseSymmetricState state,
    NoiseRole role,
  ) async {
    final material = await _deriveMaterial(
      secret: Uint8List(0),
      salt: state.chainingKey,
    );
    final initiatorSendKey = Uint8List.fromList(
      material.sublist(0, _directionalKeyLength),
    );
    final responderSendKey = Uint8List.fromList(
      material.sublist(_directionalKeyLength, _sessionKeyBytes),
    );
    return role == NoiseRole.initiator
        ? (sendKey: initiatorSendKey, recvKey: responderSendKey)
        : (sendKey: responderSendKey, recvKey: initiatorSendKey);
  }

  Future<Uint8List> _deriveMaterial({
    required Uint8List secret,
    required Uint8List salt,
  }) async {
    final material = await _hkdf.deriveKey(
      secretKey: SecretKey(secret),
      nonce: salt,
      info: _emptyInfo,
    );
    return Uint8List.fromList(await material.extractBytes());
  }

  Future<Uint8List> _dh(
    SimpleKeyPair keyPair,
    Uint8List remotePublicKey,
  ) async {
    final sharedSecret = await _x25519.sharedSecretKey(
      keyPair: keyPair,
      remotePublicKey: SimplePublicKey(
        Uint8List.fromList(remotePublicKey),
        type: KeyPairType.x25519,
      ),
    );
    return Uint8List.fromList(await sharedSecret.extractBytes());
  }

  Future<Uint8List> _encryptWithAad({
    required Uint8List plaintext,
    required Uint8List key,
    required Uint8List aad,
  }) async {
    final secretBox = await _aead.encrypt(
      plaintext,
      secretKey: SecretKey(key),
      nonce: _zeroNonce,
      aad: aad,
    );
    return Uint8List.fromList(secretBox.concatenation(nonce: false, mac: true));
  }

  Future<Uint8List> _decryptWithAad({
    required Uint8List ciphertext,
    required Uint8List key,
    required Uint8List aad,
  }) async {
    if (ciphertext.length < 16) {
      throw const FormatException('ciphertext is too short');
    }
    final secretBox = SecretBox.fromConcatenation(
      ciphertext,
      nonceLength: 0,
      macLength: 16,
    );
    final plaintext = await _aead.decrypt(
      SecretBox(secretBox.cipherText, nonce: _zeroNonce, mac: secretBox.mac),
      secretKey: SecretKey(key),
      aad: aad,
    );
    return Uint8List.fromList(plaintext);
  }

  bool _bytesEqual(Uint8List left, Uint8List right) {
    if (left.length != right.length) {
      return false;
    }
    for (var index = 0; index < left.length; index += 1) {
      if (left[index] != right[index]) {
        return false;
      }
    }
    return true;
  }
}

class _NoiseSymmetricState {
  const _NoiseSymmetricState({
    required this.chainingKey,
    required this.handshakeHash,
    required this.cipherKey,
  });

  final Uint8List chainingKey;
  final Uint8List handshakeHash;
  final Uint8List? cipherKey;
}
