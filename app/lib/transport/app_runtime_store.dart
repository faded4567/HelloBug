import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';

import '../crypto/envelope_signer.dart';
import '../crypto/keys.dart';
import '../crypto/noise_ik.dart';
import '../crypto/nonce_counter.dart';
import '../crypto/secure_store.dart';
import '../crypto/session_cipher.dart';
import '../models/inner_message.dart';
import 'ws_client.dart';

const _encryptedAppMessageTypes = <String>{
  'session.start',
  'session.agent.add',
  'session.input',
  'session.input.image',
  'session.input.voice_text',
  'session.command.slash',
  'session.cancel',
  'danger.allow',
  'danger.deny',
  'fs.tree.req',
  'fs.file.req',
  'history.get',
  'slash.list',
  'pty.input',
  'pty.resize',
};

const _defaultRatchetMessageLimit = 100;
const _defaultRatchetMaxAge = Duration(minutes: 10);

class _TransportCryptoContext {
  _TransportCryptoContext({
    required this.localPrivateKey,
    required this.senderPubkey,
    required this.pairedDaemonPubKey,
    this.initialTransportSendKey,
    this.initialTransportRecvKey,
  });

  final Uint8List localPrivateKey;
  final String senderPubkey;
  final String pairedDaemonPubKey;
  final Uint8List? initialTransportSendKey;
  final Uint8List? initialTransportRecvKey;
  final Map<String, _TransportSessionCryptoState> _sessions = {};

  Future<_TransportSessionCryptoState> session(String sessionId) async {
    final existing = _sessions[sessionId];
    if (existing != null) {
      return existing;
    }

    final initialSendKey = initialTransportSendKey;
    final initialRecvKey = initialTransportRecvKey;
    SessionCipher currentCipher;
    if (initialSendKey != null && initialRecvKey != null) {
      currentCipher = SessionCipher(
        sendKey: Uint8List.fromList(initialSendKey),
        recvKey: Uint8List.fromList(initialRecvKey),
      );
    } else {
      final derived = await AppRuntimeStore._noiseIk.deriveSessionKeys(
        localStaticPriv: localPrivateKey,
        remoteStaticPub: NoiseIk.decodePublicKeyBase64Url(pairedDaemonPubKey),
        role: NoiseRole.initiator,
      );
      currentCipher = SessionCipher(
        sendKey: derived.sendKey,
        recvKey: derived.recvKey,
      );
    }
    final created = _TransportSessionCryptoState(
      localPrivateKey: Uint8List.fromList(localPrivateKey),
      senderPubkey: senderPubkey,
      remotePubkey: pairedDaemonPubKey,
      currentCipher: currentCipher,
    );
    _sessions[sessionId] = created;
    return created;
  }
}

class _TransportSessionCryptoState {
  _TransportSessionCryptoState({
    required this.localPrivateKey,
    required this.senderPubkey,
    required this.remotePubkey,
    required this.currentCipher,
  });

  Uint8List localPrivateKey;
  String senderPubkey;
  String remotePubkey;
  SessionCipher currentCipher;
  SessionCipher? previousCipher;
  int outboundEncryptedCount = 0;
  DateTime lastRatchetAt = DateTime.now();
  String? pendingRatchetPubKey;

  Future<String> decrypt(
    Uint8List ciphertext,
    Uint8List nonce,
  ) async {
    try {
      final plaintext = await currentCipher.decrypt(ciphertext, nonce);
      return utf8.decode(plaintext);
    } catch (_) {
      final previous = previousCipher;
      if (previous == null) {
        rethrow;
      }
      final plaintext = await previous.decrypt(ciphertext, nonce);
      return utf8.decode(plaintext);
    }
  }
}

class AppRuntimeState {
  const AppRuntimeState({
    required this.serverUrl,
    required this.deviceId,
    required this.jwt,
    this.pairedDaemonId,
    this.pairedDaemonPubKey,
    this.pairedDaemonEd25519PubKey,
    this.initialTransportSendKey,
    this.initialTransportRecvKey,
    this.machineName,
    this.os,
  });

  final String serverUrl;
  // App-side device id embedded in the app JWT, used for auth.attach.
  final String deviceId;
  final String jwt;
  final String? pairedDaemonId;
  final String? pairedDaemonPubKey;
  final String? pairedDaemonEd25519PubKey;
  final String? initialTransportSendKey;
  final String? initialTransportRecvKey;
  final String? machineName;
  final String? os;

  WsClient createClient() {
    var currentJwt = jwt;
    final deviceKeys = DeviceKeys.loadOrCreate();
    final client = WsClient(
      serverUri: Uri.parse(serverUrl),
      deviceId: deviceId,
      getJwt: () => currentJwt,
      onJwt: (nextJwt) {
        currentJwt = nextJwt;
        unawaited(SecureStore.write(SecureStore.keyJwt, nextJwt));
      },
      signEnvelope: (
        from,
        to,
        sessionId,
        seq,
        ts,
        ciphertext, [
        messageType,
        cipherMode,
        senderPubkey,
      ]) async {
        final keys = await deviceKeys;
        return EnvelopeSigner(keys.ed25519).sign(
          from,
          to,
          sessionId,
          seq,
          ts,
          ciphertext,
          messageType,
          cipherMode,
          senderPubkey,
        );
      },
    );
    if (pairedDaemonPubKey != null && pairedDaemonPubKey!.isNotEmpty) {
      AppRuntimeStore.configureClientCrypto(
        client,
        pairedDaemonPubKey: pairedDaemonPubKey!,
        deviceKeys: deviceKeys,
        initialTransportSendKey: initialTransportSendKey,
        initialTransportRecvKey: initialTransportRecvKey,
      );
    }
    return client;
  }
}

class AppRuntimeStore {
  static final Random _rng = Random.secure();
  static final NoiseIk _noiseIk = NoiseIk();

  static Future<AppRuntimeState?> load() async {
    final serverUrl = await SecureStore.read(SecureStore.keyServerUrl);
    final deviceId = await SecureStore.read(SecureStore.keyPairedDeviceId);
    final jwt = await SecureStore.read(SecureStore.keyJwt);
    if (serverUrl == null || deviceId == null || jwt == null) {
      return null;
    }

    final machineName = await SecureStore.read(
      SecureStore.keyPairedMachineName,
    );
    final os = await SecureStore.read(SecureStore.keyPairedOs);
    final pairedDaemonId = await SecureStore.read(
      SecureStore.keyPairedDaemonId,
    );
    final pairedDaemonPubKey = await SecureStore.read(
      SecureStore.keyPairedDaemonPubKey,
    );
    final pairedDaemonEd25519PubKey = await SecureStore.read(
      SecureStore.keyPairedDaemonEd25519PubKey,
    );
    final initialTransportSendKey = await SecureStore.read(
      SecureStore.keyPairedTransportSendKey,
    );
    final initialTransportRecvKey = await SecureStore.read(
      SecureStore.keyPairedTransportRecvKey,
    );
    final hasInitialTransportKeys =
        initialTransportSendKey != null &&
        initialTransportSendKey.isNotEmpty &&
        initialTransportRecvKey != null &&
        initialTransportRecvKey.isNotEmpty;
    return AppRuntimeState(
      serverUrl: serverUrl,
      deviceId: deviceId,
      jwt: jwt,
      pairedDaemonId: pairedDaemonId,
      pairedDaemonPubKey: pairedDaemonPubKey,
      pairedDaemonEd25519PubKey: pairedDaemonEd25519PubKey,
      initialTransportSendKey:
          hasInitialTransportKeys ? initialTransportSendKey : null,
      initialTransportRecvKey:
          hasInitialTransportKeys ? initialTransportRecvKey : null,
      machineName: machineName,
      os: os,
    );
  }

  static Future<AppRuntimeState> persist({
    required String serverUrl,
    required String jwt,
    String? pairedDaemonId,
    String? pairedDaemonPubKey,
    String? pairedDaemonEd25519PubKey,
    String? initialTransportSendKey,
    String? initialTransportRecvKey,
    String? machineName,
    String? os,
  }) async {
    final appDeviceId = parseDeviceIdFromJwt(jwt);
    if (appDeviceId == null) {
      throw const FormatException('JWT missing device_id');
    }

    await Future.wait([
      SecureStore.write(SecureStore.keyServerUrl, serverUrl),
      SecureStore.write(SecureStore.keyPairedDeviceId, appDeviceId),
      SecureStore.write(SecureStore.keyJwt, jwt),
      if (pairedDaemonId != null)
        SecureStore.write(SecureStore.keyPairedDaemonId, pairedDaemonId),
      if (pairedDaemonPubKey != null)
        SecureStore.write(
          SecureStore.keyPairedDaemonPubKey,
          pairedDaemonPubKey,
        ),
      if (pairedDaemonEd25519PubKey != null)
        SecureStore.write(
          SecureStore.keyPairedDaemonEd25519PubKey,
          pairedDaemonEd25519PubKey,
        ),
      if (initialTransportSendKey != null && initialTransportRecvKey != null)
        SecureStore.write(
          SecureStore.keyPairedTransportSendKey,
          initialTransportSendKey,
        ),
      if (initialTransportSendKey != null && initialTransportRecvKey != null)
        SecureStore.write(
          SecureStore.keyPairedTransportRecvKey,
          initialTransportRecvKey,
        ),
      if (machineName != null)
        SecureStore.write(SecureStore.keyPairedMachineName, machineName),
      if (os != null) SecureStore.write(SecureStore.keyPairedOs, os),
    ]);

    return AppRuntimeState(
      serverUrl: serverUrl,
      deviceId: appDeviceId,
      jwt: jwt,
      pairedDaemonId: pairedDaemonId,
      pairedDaemonPubKey: pairedDaemonPubKey,
      pairedDaemonEd25519PubKey: pairedDaemonEd25519PubKey,
      initialTransportSendKey:
          initialTransportSendKey != null && initialTransportRecvKey != null
              ? initialTransportSendKey
              : null,
      initialTransportRecvKey:
          initialTransportSendKey != null && initialTransportRecvKey != null
              ? initialTransportRecvKey
              : null,
      machineName: machineName,
      os: os,
    );
  }

  static Future<void> persistPairedDaemon({
    required String daemonDeviceId,
    String? daemonPubKey,
    String? daemonEd25519PubKey,
    String? machineName,
    String? os,
  }) async {
    await Future.wait([
      SecureStore.write(SecureStore.keyPairedDaemonId, daemonDeviceId),
      if (daemonPubKey != null)
        SecureStore.write(SecureStore.keyPairedDaemonPubKey, daemonPubKey),
      if (daemonEd25519PubKey != null)
        SecureStore.write(
          SecureStore.keyPairedDaemonEd25519PubKey,
          daemonEd25519PubKey,
        ),
      if (machineName != null)
        SecureStore.write(SecureStore.keyPairedMachineName, machineName),
      if (os != null) SecureStore.write(SecureStore.keyPairedOs, os),
    ]);
  }

  static Future<void> clear() async {
    await Future.wait([
      SecureStore.delete(SecureStore.keyServerUrl),
      SecureStore.delete(SecureStore.keyPairedDeviceId),
      SecureStore.delete(SecureStore.keyPairedDaemonId),
      SecureStore.delete(SecureStore.keyPairedDaemonPubKey),
      SecureStore.delete(SecureStore.keyPairedDaemonEd25519PubKey),
      SecureStore.delete(SecureStore.keyPairedTransportSendKey),
      SecureStore.delete(SecureStore.keyPairedTransportRecvKey),
      SecureStore.delete(SecureStore.keyJwt),
      SecureStore.delete(SecureStore.keyPairedMachineName),
      SecureStore.delete(SecureStore.keyPairedOs),
    ]);
  }

  static Future<String> loadOrCreateInstanceId() async {
    final existing = await SecureStore.read(SecureStore.keyAppInstanceId);
    if (existing != null && existing.isNotEmpty) {
      return existing;
    }

    final created = _randomId();
    await SecureStore.write(SecureStore.keyAppInstanceId, created);
    return created;
  }

  static String defaultDeviceName() {
    if (kIsWeb) {
      return 'HelloBug Web';
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return 'HelloBug iPhone';
    }
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'HelloBug Android';
    }
    return 'HelloBug App';
  }

  static String? parseDeviceIdFromJwt(String jwt) {
    final parts = jwt.split('.');
    if (parts.length < 2) {
      return null;
    }

    try {
      final payload =
          jsonDecode(
                utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
              )
              as Map<String, dynamic>;
      final deviceId = payload['device_id'];
      return deviceId is String && deviceId.isNotEmpty ? deviceId : null;
    } catch (_) {
      return null;
    }
  }

  static String _randomId() {
    final bytes = List<int>.generate(16, (_) => _rng.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    String toHex(List<int> values) =>
        values.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${toHex(bytes.sublist(0, 4))}-${toHex(bytes.sublist(4, 6))}'
        '-${toHex(bytes.sublist(6, 8))}-${toHex(bytes.sublist(8, 10))}'
        '-${toHex(bytes.sublist(10))}';
  }

  static void configureClientCrypto(
    WsClient client, {
    required String pairedDaemonPubKey,
    Future<DeviceKeys>? deviceKeys,
    String? initialTransportSendKey,
    String? initialTransportRecvKey,
    int ratchetMessageLimit = _defaultRatchetMessageLimit,
    Duration ratchetMaxAge = _defaultRatchetMaxAge,
  }) {
    final resolvedDeviceKeys = deviceKeys ?? DeviceKeys.loadOrCreate();
    final context = _createTransportCryptoContext(
      pairedDaemonPubKey: pairedDaemonPubKey,
      deviceKeys: resolvedDeviceKeys,
      initialTransportSendKey: initialTransportSendKey,
      initialTransportRecvKey: initialTransportRecvKey,
    );

    Future<void> maybeInitiateRatchet(
      InnerMessage message,
      WsClient liveClient,
    ) async {
      if (!_encryptedAppMessageTypes.contains(message.type)) {
        return;
      }

      final sessionId = message.payload['session_id'] as String? ?? '';
      if (sessionId.isEmpty) {
        return;
      }

      final crypto = await context;
      final session = await crypto.session(sessionId);
      if (session.pendingRatchetPubKey != null) {
        return;
      }

      final ratchetDueByCount =
          session.outboundEncryptedCount >= ratchetMessageLimit;
      final ratchetDueByTime =
          DateTime.now().difference(session.lastRatchetAt) >= ratchetMaxAge;
      if (!ratchetDueByCount && !ratchetDueByTime) {
        return;
      }

      await resolvedDeviceKeys;
      final nextLocalKeyPair = await X25519().newKeyPair();
      final nextLocalPub = await nextLocalKeyPair.extractPublicKey();
      final nextLocalPrivBytes = await nextLocalKeyPair.extractPrivateKeyBytes();
      final nextLocalPubBase64 = base64Url
          .encode(nextLocalPub.bytes)
          .replaceAll('=', '');
      final derived = await _noiseIk.deriveSessionKeys(
        localStaticPriv: Uint8List.fromList(nextLocalPrivBytes),
        remoteStaticPub: NoiseIk.decodePublicKeyBase64Url(session.remotePubkey),
        role: NoiseRole.initiator,
      );

      session.previousCipher = session.currentCipher;
      session.localPrivateKey = Uint8List.fromList(nextLocalPrivBytes);
      session.currentCipher = SessionCipher(
        sendKey: derived.sendKey,
        recvKey: derived.recvKey,
      );
      session.senderPubkey = nextLocalPubBase64;
      session.outboundEncryptedCount = 0;
      session.lastRatchetAt = DateTime.now();
      session.pendingRatchetPubKey = nextLocalPubBase64;

      await liveClient.send(
        InnerMessage.create('key.ratchet', {
          'session_id': sessionId,
          'next_pubkey': nextLocalPubBase64,
        }),
      );
    }

    client.beforeSend = maybeInitiateRatchet;

    client.encrypt = (data, sessionId, seq, messageType) async {
      if (!_encryptedAppMessageTypes.contains(messageType) ||
          sessionId.isEmpty) {
        return (
          ciphertext: base64Url.encode(utf8.encode(data)),
          cipherMode: 'plain',
          senderPubkey: null,
        );
      }

      final crypto = await context;
      final session = await crypto.session(sessionId);
      final nonce = await NonceCounter(sessionId).fromCounter(seq);
      final ciphertext = await session.currentCipher.encrypt(
        Uint8List.fromList(utf8.encode(data)),
        nonce,
      );
      session.outboundEncryptedCount += 1;
      return (
        ciphertext: base64Url.encode(ciphertext),
        cipherMode: 'noise_static_v1',
        senderPubkey: session.senderPubkey,
      );
    };

    client.decrypt = ({
      required String ciphertext,
      required String sessionId,
      required int seq,
      required String messageType,
      required String cipherMode,
      String? senderPubkey,
    }) async {
      if (cipherMode != 'noise_static_v1') {
        return utf8.decode(base64Url.decode(base64Url.normalize(ciphertext)));
      }
      if (sessionId.isEmpty) {
        throw const FormatException('encrypted envelope missing session_id');
      }

      final crypto = await context;
      final session = await crypto.session(sessionId);
      final nonce = await NonceCounter(sessionId).fromCounter(seq);
      return session.decrypt(
        Uint8List.fromList(base64Url.decode(base64Url.normalize(ciphertext))),
        nonce,
      );
    };

    client.interceptMessage = (message, liveClient) async {
      if (message.type == 'key.ratchet') {
        final sessionId = message.payload['session_id'] as String? ?? '';
        final nextPubkey = message.payload['next_pubkey'] as String? ?? '';
        if (sessionId.isEmpty || nextPubkey.isEmpty) {
          throw const FormatException('invalid key.ratchet payload');
        }

        final crypto = await context;
        final session = await crypto.session(sessionId);
        final derived = await _noiseIk.deriveSessionKeys(
          localStaticPriv: session.localPrivateKey,
          remoteStaticPub: NoiseIk.decodePublicKeyBase64Url(nextPubkey),
          role: NoiseRole.responder,
        );
        session.previousCipher = session.currentCipher;
        session.currentCipher = SessionCipher(
          sendKey: derived.sendKey,
          recvKey: derived.recvKey,
        );
        session.remotePubkey = nextPubkey;
        session.outboundEncryptedCount = 0;
        session.lastRatchetAt = DateTime.now();
        session.pendingRatchetPubKey = null;

        await liveClient.send(
          InnerMessage.create('key.ratchet_ack', {'session_id': sessionId}),
        );
        return true;
      }

      if (message.type == 'key.ratchet_ack') {
        final sessionId = message.payload['session_id'] as String? ?? '';
        if (sessionId.isEmpty) {
          throw const FormatException('invalid key.ratchet_ack payload');
        }
        final crypto = await context;
        final session = await crypto.session(sessionId);
        session.previousCipher = null;
        session.pendingRatchetPubKey = null;
        session.lastRatchetAt = DateTime.now();
        return true;
      }

      return false;
    };
  }

  static Future<_TransportCryptoContext> _createTransportCryptoContext({
    required String pairedDaemonPubKey,
    required Future<DeviceKeys> deviceKeys,
    String? initialTransportSendKey,
    String? initialTransportRecvKey,
  }) async {
    final keys = await deviceKeys;
    final localPrivateKey = Uint8List.fromList(
      await keys.x25519.extractPrivateKeyBytes(),
    );
    final localPubkey = await keys.x25519PubBase64();
    final hasInitialTransportKeys =
        initialTransportSendKey != null &&
        initialTransportSendKey.isNotEmpty &&
        initialTransportRecvKey != null &&
        initialTransportRecvKey.isNotEmpty;
    return _TransportCryptoContext(
      localPrivateKey: localPrivateKey,
      senderPubkey: localPubkey,
      pairedDaemonPubKey: pairedDaemonPubKey,
      initialTransportSendKey:
          hasInitialTransportKeys
              ? _decodeBase64Url(initialTransportSendKey)
              : null,
      initialTransportRecvKey:
          hasInitialTransportKeys
              ? _decodeBase64Url(initialTransportRecvKey)
              : null,
    );
  }

  static Uint8List _decodeBase64Url(String encoded) =>
      Uint8List.fromList(base64Url.decode(base64Url.normalize(encoded)));
}
