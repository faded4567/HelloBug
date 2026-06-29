import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';

import '../models/inner_message.dart';
import 'connection_state.dart';
import 'envelope_routing.dart';
import 'framed_codec.dart';
import 'pinned_http_client.dart';
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
      String? requestId,
      String? messageType,
      String? cipherMode,
      String? senderPubkey,
      String? routingPayload,
    ]);
typedef WsSocketFactory = PlatformWsSocket Function(Uri uri);

const _routingPayloadPlaceholderMessageTypes = <String>{
  'auth.token',
  'device.list',
  'device.pair.sas',
  'device.rename',
  'device.revoke',
  'device.status',
  'error',
  'session.start.result',
  'replay.done',
};

class WsClient {
  final Uri serverUri;
  final String Function() getJwt;
  final void Function(String jwt)? onJwt;
  final EnvelopeSignFn? signEnvelope;
  final WsSocketFactory _socketFactory;

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
  Timer? _refreshTimer;
  bool _disposed = false;
  bool _authenticated = false;
  String _deviceId;
  final Map<String, int> _lastSeq = {}; // session_id → last received seq
  final Set<String> _trackedSessions = {};
  final Set<String> _pendingReplaySessions = {};
  final Set<String> _invalidReplaySessions = {};
  bool _awaitingReplayAfterAttach = false;

  WsClient({
    required this.serverUri,
    required String deviceId,
    required this.getJwt,
    this.onJwt,
    this.signEnvelope,
    WsSocketFactory? socketFactory,
  }) : _deviceId = deviceId,
       _socketFactory = socketFactory ?? createPlatformWebSocketChannel;

  Stream<InnerMessage> get messages => _msgCtrl.stream;
  Stream<WsConnectionState> get states => _stateCtrl.stream;
  Map<String, int> get lastSeq => Map.unmodifiable(_lastSeq);
  Set<String> get trackedSessions => Set.unmodifiable(_trackedSessions);
  Set<String> get pendingReplaySessions =>
      Set.unmodifiable(_pendingReplaySessions);
  Set<String> get invalidReplaySessions =>
      Set.unmodifiable(_invalidReplaySessions);
  String get deviceId => _deviceId;
  bool get isAuthenticated => _authenticated;

  Future<void> connect({bool rethrowErrors = false}) async {
    if (_disposed) return;
    _emit(WsConnectionState.connecting);
    try {
      debugPrint('[WsClient] connect -> $serverUri');
      _ch = _socketFactory(serverUri);
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
      final decorated = _decorateConnectError(error);
      debugPrint('[WsClient] connect error -> $decorated');
      _scheduleRetry();
      if (rethrowErrors) {
        throw decorated;
      }
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
    final sessionId = resolveEnvelopeSessionIdForMessage(msg);
    final requestId = envelopeRequestIdForMessage(msg);
    final routingPayload = envelopeRoutingPayloadForMessage(msg);
    final requiresNoiseTransport =
        routingPayload == null && sessionId.isNotEmpty;
    if (encrypt == null && requiresNoiseTransport) {
      throw StateError(
        'Transport crypto is not configured for $messageType '
        '(session_id=$sessionId)',
      );
    }
    final seq = _nextSeq();
    final crypto =
        encrypt != null
            ? await encrypt!(plain, sessionId, seq, messageType)
            : routingPayload != null
            ? (
              ciphertext: base64Url.encode(utf8.encode('opaque')),
              cipherMode: 'noise_static_v1',
              senderPubkey: null,
            )
            : (
              ciphertext: base64Url.encode(utf8.encode(plain)),
              cipherMode: 'plain',
              senderPubkey: null,
            );
    if (requiresNoiseTransport && crypto.cipherMode != 'noise_static_v1') {
      throw StateError(
        'Transport crypto must use noise_static_v1 for $messageType '
        '(session_id=$sessionId)',
      );
    }
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
              requestId,
              messageType,
              crypto.cipherMode,
              crypto.senderPubkey,
              routingPayload,
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
      if (requestId != null) 'request_id': requestId,
      if (routingPayload != null) 'routing_payload': routingPayload,
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
          final routingPayload = obj['routing_payload'] as String?;
          final preferDecryptedSessionStartResult =
              messageType == 'session.start.result' &&
              cipherMode == 'noise_static_v1' &&
              senderPubkey != null &&
              senderPubkey.isNotEmpty &&
              decrypt != null;
          final msg =
              !preferDecryptedSessionStartResult &&
                      cipherMode == 'noise_static_v1' &&
                      _routingPayloadPlaceholderMessageTypes.contains(
                        messageType,
                      ) &&
                      routingPayload != null &&
                      routingPayload.isNotEmpty
                  ? _messageFromRoutingPayload(
                    messageType,
                    routingPayload,
                    requestId: obj['request_id'] as String?,
                  )
                  : InnerMessage.fromJson(
                    jsonDecode(
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
                                base64Url.decode(
                                  base64Url.normalize(ciphertext),
                                ),
                              ),
                        )
                        as Map<String, dynamic>,
                  );
          if (interceptMessage != null && await interceptMessage!(msg, this)) {
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
      _authenticated = true;
      final jwt = msg.payload['jwt'] as String?;
      final expiresAt = (msg.payload['expires_at'] as num?)?.toInt();
      if (jwt != null && jwt.isNotEmpty) {
        onJwt?.call(jwt);
      }
      if (expiresAt != null && expiresAt > 0) {
        _scheduleJwtRefresh(expiresAt);
      }
      if (_awaitingReplayAfterAttach) {
        _awaitingReplayAfterAttach = false;
        _requestReplays();
      }
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

  InnerMessage _messageFromRoutingPayload(
    String messageType,
    String routingPayload, {
    String? requestId,
  }) {
    final payload =
        jsonDecode(
              utf8.decode(
                base64Url.decode(base64Url.normalize(routingPayload)),
              ),
            )
            as Map<String, dynamic>;
    return InnerMessage.fromJson({
      'v': 1,
      if (requestId != null && requestId.isNotEmpty) 'id': requestId,
      'type': messageType,
      'payload': payload,
    });
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
    _awaitingReplayAfterAttach = true;
    unawaited(send(InnerMessage.create('auth.attach', {'jwt': jwt})));
  }

  void _sendAuthRefresh() {
    final jwt = getJwt();
    if (jwt.isEmpty || _ch == null || _disposed) {
      return;
    }
    unawaited(send(InnerMessage.create('auth.refresh', {'jwt': jwt})));
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

  void _scheduleJwtRefresh(int expiresAtMs) {
    _refreshTimer?.cancel();
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final remainingMs = expiresAtMs - nowMs;
    if (remainingMs <= 0) {
      _sendAuthRefresh();
      return;
    }

    final leadMs = const Duration(minutes: 2).inMilliseconds;
    final delayMs =
        remainingMs > leadMs
            ? remainingMs - leadMs
            : max(5000, remainingMs ~/ 2);
    _refreshTimer = Timer(Duration(milliseconds: delayMs), _sendAuthRefresh);
  }

  Object _decorateConnectError(Object error) {
    final pinFailure = PinnedHttpClient.takeLastFailure(serverUri);
    if (pinFailure != null) {
      return StateError(pinFailure);
    }
    return error;
  }

  void _scheduleRetry() {
    if (_disposed) return;
    _sub?.cancel();
    unawaited(_ch?.close());
    _ch = null;
    _authenticated = false;
    _awaitingReplayAfterAttach = false;
    _pendingReplaySessions.clear();
    _refreshTimer?.cancel();
    _emit(WsConnectionState.offline);
    _retryTimer?.cancel();
    _retryTimer = Timer(_policy.next(), () => connect());
  }

  void _emit(WsConnectionState s) {
    if (!_stateCtrl.isClosed) _stateCtrl.add(s);
  }

  void dispose() {
    _disposed = true;
    _authenticated = false;
    _retryTimer?.cancel();
    _refreshTimer?.cancel();
    _sub?.cancel();
    unawaited(_ch?.close());
    _msgCtrl.close();
    _stateCtrl.close();
  }
}
