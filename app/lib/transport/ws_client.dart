import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../models/envelope.dart';
import '../models/inner_message.dart';
import 'connection_state.dart';
import 'framed_codec.dart';
import 'reconnect_policy.dart';
import 'ws_channel_factory.dart';

// Injected after Spike F1; null = no E2EE (M1 development mode).
typedef CryptoFn = Future<String> Function(String data, String sessionId);

class WsClient {
  final Uri serverUri;
  final String deviceId;
  final String Function() getJwt;
  final void Function(String jwt)? onJwt;

  CryptoFn? encrypt;
  CryptoFn? decrypt;

  final _msgCtrl = StreamController<InnerMessage>.broadcast();
  final _stateCtrl = StreamController<WsConnectionState>.broadcast();
  final _codec = FramedCodec();
  final _policy = ReconnectPolicy();

  PlatformWsSocket? _ch;
  StreamSubscription<dynamic>? _sub;
  Timer? _retryTimer;
  bool _disposed = false;
  final Map<String, int> _lastSeq = {}; // session_id → last received seq

  WsClient({
    required this.serverUri,
    required this.deviceId,
    required this.getJwt,
    this.onJwt,
  });

  Stream<InnerMessage> get messages => _msgCtrl.stream;
  Stream<WsConnectionState> get states => _stateCtrl.stream;
  Map<String, int> get lastSeq => Map.unmodifiable(_lastSeq);

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
    debugPrint(
      '[WsClient] send -> ${msg.type} id=${msg.id} session=${msg.payload['session_id'] ?? ''}',
    );
    final plain = jsonEncode(msg.toJson());
    final sessionId = msg.payload['session_id'] as String? ?? '';
    final ciphertext =
        encrypt != null
            ? await encrypt!(plain, sessionId)
            : base64Url.encode(
              utf8.encode(plain),
            ); // M1 stub: no actual encryption

    final env = Envelope(
      from: deviceId,
      to: '',
      sessionId: sessionId,
      seq: _nextSeq(sessionId),
      ts: DateTime.now().millisecondsSinceEpoch,
      sig: '', // signing added after Spike F1
      ciphertext: ciphertext,
    );
    _ch!.sendText(_codec.encode(env.toJson()));
  }

  // Called by chat_provider when a session.event is received.
  void updateLastSeq(String sessionId, int seq) => _lastSeq[sessionId] = seq;

  Future<void> _onFrame(dynamic raw) async {
    final frameText = _coerceFrameText(raw);
    debugPrint('[WsClient] frame <- ${raw.runtimeType}');
    for (final obj in _codec.decode(frameText)) {
      try {
        if (obj.containsKey('ciphertext')) {
          final env = Envelope.fromJson(obj);
          final text =
              decrypt != null
                  ? await decrypt!(env.ciphertext, env.sessionId)
                  : utf8.decode(
                    base64Url.decode(base64Url.normalize(env.ciphertext)),
                  );
          final msg = InnerMessage.fromJson(
            jsonDecode(text) as Map<String, dynamic>,
          );
          _handleIncomingMessage(msg, sessionId: env.sessionId, seq: env.seq);
          continue;
        }

        final msg = InnerMessage.fromJson(obj);
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
    if (sessionId.isNotEmpty && seq != null) {
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
      _emit(WsConnectionState.online);
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
    if (_lastSeq.isEmpty) return;
    _emit(WsConnectionState.replaying);
    for (final e in _lastSeq.entries) {
      send(
        InnerMessage.create('session.resume', {
          'session_id': e.key,
          'last_seq': e.value,
        }),
      );
    }
  }

  int _seqCounter = 0;
  int _nextSeq(String sessionId) => ++_seqCounter;

  void _scheduleRetry() {
    if (_disposed) return;
    _sub?.cancel();
    unawaited(_ch?.close());
    _ch = null;
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
