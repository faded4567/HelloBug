import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';

import '../models/inner_message.dart';
import 'connection_state.dart';
import 'framed_codec.dart';
import 'reconnect_policy.dart';
import 'ws_channel_factory.dart';

typedef EnvelopeCryptoResult =
    ({String ciphertext, String cipherMode, String? senderPubkey});
typedef CryptoFn =
    Future<EnvelopeCryptoResult> Function(
      String data,
      String sessionId,
      int seq,
      String messageType,
    );
typedef DecryptFn =
    Future<String> Function({
      required String ciphertext,
      required String sessionId,
      required int seq,
      required String messageType,
      required String cipherMode,
      String? senderPubkey,
    });
typedef TransportMessageInterceptor =
    Future<bool> Function(InnerMessage message, WsClient client);
typedef OutgoingMessageInterceptor =
    Future<void> Function(InnerMessage message, WsClient client);
typedef EnvelopeSignFn =
    Future<String> Function(
      String from,
      String to,
      String sessionId,
      int seq,
      int ts,
      String ciphertext, [
      String? messageType,
      String? cipherMode,
      String? senderPubkey,
    ]);

class WsClient {
  final Uri serverUri;
  final String Function() getJwt;
  final void Function(String jwt)? onJwt;
  final EnvelopeSignFn? signEnvelope;

  CryptoFn? encrypt;
  DecryptFn? decrypt;
  TransportMessageInterceptor? interceptMessage;
  OutgoingMessageInterceptor? beforeSend;

  final _msgCtrl = StreamController<InnerMessage>.broadcast();
  final _stateCtrl = StreamController<WsConnectionState>.broadcast();
  final _codec = FramedCodec();
  final _policy = ReconnectPolicy();

  PlatformWsSocket? _ch;
  StreamSubscription<dynamic>? _sub;
  Timer? _retryTimer;
  bool _disposed = false;
  String _deviceId;
  final Map<String, int> _lastSeq = {}; // session_id → last received seq
  final Set<String> _trackedSessions = {};
  final Set<String> _pendingReplaySessions = {};
  final Set<String> _invalidReplaySessions = {};

  WsClient({
    required this.serverUri,
    required String deviceId,
    required this.getJwt,
    this.onJwt,
    this.signEnvelope,
  }) : _deviceId = deviceId;

  Stream<InnerMessage> get messages => _msgCtrl.stream;
  Stream<WsConnectionState> get states => _stateCtrl.stream;
  Map<String, int> get lastSeq => Map.unmodifiable(_lastSeq);
  Set<String> get trackedSessions => Set.unmodifiable(_trackedSessions);
  Set<String> get pendingReplaySessions => Set.unmodifiable(_pendingReplaySessions);
  Set<String> get invalidReplaySessions => Set.unmodifiable(_invalidReplaySessions);
  String get deviceId => _deviceId;

  Future<void> connect() async {
    if (_disposed) return;
    _emit(WsConnectionState.connecting);
    try {
      debugPrint('[WsClient] connect -> $serverUri');
      _ch = createPlatformWebSocketChannel(serverUri);
      _sub = _ch!.stream.listen(
        (raw) {
          debugPrint('[WsClient] raw <- ${raw.runtimeType}');
          unawaited(_onFrame(raw));
        },
        onError: (Object error, StackTrace stackTrace) {
          debugPrint('[WsClient] stream error -> $error');
          _scheduleRetry();
        },
        onDone: () {
          debugPrint('[WsClient] stream done');
          _scheduleRetry();
        },
      );
      await _ch!.ready;
      debugPrint('[WsClient] connected -> $serverUri');
      _policy.reset();
      _emit(WsConnectionState.online);
      _sendAuthAttach();
    } catch (error) {
      debugPrint('[WsClient] connect error -> $error');
      _scheduleRetry();
    }
  }

  Future<void> send(InnerMessage msg) async {
    if (_ch == null) return;
    if (beforeSend != null) {
      await beforeSend!(msg, this);
    }
    debugPrint(
      '[WsClient] send -> ${msg.type} id=${msg.id} session=${msg.payload['session_id'] ?? ''}',
    );
    final plain = jsonEncode(msg.toJson());
    final messageType = msg.type;
    final sessionId = msg.payload['session_id'] as String? ?? '';
    final seq = _nextSeq();
    final crypto =
        encrypt != null
            ? await encrypt!(plain, sessionId, seq, messageType)
            : (
              ciphertext: base64Url.encode(utf8.encode(plain)),
              cipherMode: 'plain',
              senderPubkey: null,
            );
    final ts = DateTime.now().millisecondsSinceEpoch;
    final sig =
        signEnvelope != null
            ? await signEnvelope!(
              _deviceId,
              '',
              sessionId,
              seq,
              ts,
              crypto.ciphertext,
              messageType,
              crypto.cipherMode,
              crypto.senderPubkey,
            )
            : '';

    final env = <String, dynamic>{
      'from': _deviceId,
      'to': '',
      'session_id': sessionId,
      'seq': seq,
      'ts': ts,
      'sig': sig,
      'ciphertext': crypto.ciphertext,
      'message_type': messageType,
      'cipher_mode': crypto.cipherMode,
      if (crypto.senderPubkey != null) 'sender_pubkey': crypto.senderPubkey,
    };
    _ch!.sendText(_codec.encode(env));
  }

  void updateDeviceId(String deviceId) {
    if (deviceId.isEmpty) {
      return;
    }
    _deviceId = deviceId;
  }

  // Called by chat_provider when a session.event is received.
  void updateLastSeq(String sessionId, int seq) => _lastSeq[sessionId] = seq;

  void trackSession(String sessionId) {
    if (sessionId.isEmpty) {
      return;
    }
    _trackedSessions.add(sessionId);
    _invalidReplaySessions.remove(sessionId);
  }

  void untrackSession(String sessionId) {
    if (sessionId.isEmpty) {
      return;
    }
    _trackedSessions.remove(sessionId);
    _pendingReplaySessions.remove(sessionId);
    _invalidReplaySessions.remove(sessionId);
    _lastSeq.remove(sessionId);
  }

  Future<void> _onFrame(dynamic raw) async {
    final frameText = _coerceFrameText(raw);
    debugPrint('[WsClient] frame <- ${raw.runtimeType}');
    for (final obj in _codec.decode(frameText)) {
      try {
        if (obj.containsKey('ciphertext')) {
          final ciphertext = obj['ciphertext'] as String? ?? '';
          final sessionId = obj['session_id'] as String? ?? '';
          final seq = (obj['seq'] as num?)?.toInt() ?? 0;
          final messageType = obj['message_type'] as String? ?? '';
          final cipherMode = obj['cipher_mode'] as String? ?? 'plain';
          final senderPubkey = obj['sender_pubkey'] as String?;
          final text =
              cipherMode == 'noise_static_v1'
                  ? await (decrypt != null
                      ? decrypt!(
                        ciphertext: ciphertext,
                        sessionId: sessionId,
                        seq: seq,
                        messageType: messageType,
                        cipherMode: cipherMode,
                        senderPubkey: senderPubkey,
                      )
                      : Future<String>.error(
                        const FormatException(
                          'missing decryptor for encrypted envelope',
                        ),
                      ))
                  : utf8.decode(
                    base64Url.decode(base64Url.normalize(ciphertext)),
                  );
          final msg = InnerMessage.fromJson(
            jsonDecode(text) as Map<String, dynamic>,
          );
          if (interceptMessage != null &&
              await interceptMessage!(msg, this)) {
            continue;
          }
          _handleIncomingMessage(msg, sessionId: sessionId, seq: seq);
          continue;
        }

        final msg = InnerMessage.fromJson(obj);
        if (interceptMessage != null && await interceptMessage!(msg, this)) {
          continue;
        }
        _handleIncomingMessage(msg);
      } catch (error) {
        debugPrint('[WsClient] frame decode error -> $error');
      }
    }
  }

  void _handleIncomingMessage(
    InnerMessage msg, {
    String sessionId = '',
    int? seq,
  }) {
    debugPrint('[WsClient] recv <- ${msg.type}');
    if (msg.type == 'error') {
      debugPrint('[WsClient] error payload <- ${jsonEncode(msg.payload)}');
    }
    if (msg.type == 'session.event' && sessionId.isNotEmpty && seq != null) {
      _lastSeq[sessionId] = seq;
    }
    _msgCtrl.add(msg);
    if (msg.type == 'auth.token') {
      final jwt = msg.payload['jwt'] as String?;
      if (jwt != null && jwt.isNotEmpty) {
        onJwt?.call(jwt);
      }
      _requestReplays();
    }
    if (msg.type == 'replay.done') {
      final sessionId = msg.payload['session_id'] as String? ?? '';
      final status = msg.payload['status'] as String? ?? 'ok';
      if (sessionId.isNotEmpty) {
        _pendingReplaySessions.remove(sessionId);
        if (status == 'session_not_found') {
          _lastSeq.remove(sessionId);
          _invalidReplaySessions.add(sessionId);
        } else {
          _invalidReplaySessions.remove(sessionId);
        }
      }
      if (_pendingReplaySessions.isEmpty) {
        _emit(WsConnectionState.online);
      }
    }
  }

  String _coerceFrameText(dynamic raw) {
    if (raw is String) {
      return raw;
    }
    if (raw is List<int>) {
      return utf8.decode(raw);
    }
    return raw.toString();
  }

  // Call when app returns to foreground and connection may have dropped.
  void reconnectIfNeeded() {
    if (_ch == null && !_disposed) {
      _retryTimer?.cancel();
      connect();
    }
  }

  void _sendAuthAttach() {
    final jwt = getJwt();
    if (jwt.isEmpty) return;
    send(InnerMessage.create('auth.attach', {'jwt': jwt}));
  }

  void _requestReplays() {
    _pendingReplaySessions
      ..clear()
      ..addAll(
        _trackedSessions.where(
          (sessionId) => !_invalidReplaySessions.contains(sessionId),
        ),
      );
    if (_pendingReplaySessions.isEmpty) return;
    _emit(WsConnectionState.replaying);
    for (final sessionId in _pendingReplaySessions) {
      send(
        InnerMessage.create('session.resume', {
          'session_id': sessionId,
          'last_seq': _lastSeq[sessionId] ?? 0,
        }),
      );
    }
  }

  int _seqCounter = Random.secure().nextInt(1 << 30);
  int _nextSeq() => ++_seqCounter;

  void _scheduleRetry() {
    if (_disposed) return;
    _sub?.cancel();
    unawaited(_ch?.close());
    _ch = null;
    _pendingReplaySessions.clear();
    _emit(WsConnectionState.offline);
    _retryTimer?.cancel();
    _retryTimer = Timer(_policy.next(), connect);
  }

  void _emit(WsConnectionState s) {
    if (!_stateCtrl.isClosed) _stateCtrl.add(s);
  }

  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    _sub?.cancel();
    unawaited(_ch?.close());
    _msgCtrl.close();
    _stateCtrl.close();
  }
}
