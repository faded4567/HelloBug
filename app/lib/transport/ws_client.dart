import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../models/envelope.dart';
import '../models/inner_message.dart';
import 'connection_state.dart';
import 'framed_codec.dart';
import 'pinned_http_client.dart';
import 'reconnect_policy.dart';

// Injected after Spike F1; null = no E2EE (M1 development mode).
typedef CryptoFn = Future<String> Function(String data, String sessionId);

class WsClient {
  final Uri serverUri;
  final String deviceId;
  final String Function() getJwt;

  CryptoFn? encrypt;
  CryptoFn? decrypt;

  final _msgCtrl   = StreamController<InnerMessage>.broadcast();
  final _stateCtrl = StreamController<WsConnectionState>.broadcast();
  final _codec     = FramedCodec();
  final _policy    = ReconnectPolicy();

  WebSocketChannel? _ch;
  StreamSubscription<dynamic>? _sub;
  Timer? _retryTimer;
  bool _disposed = false;
  final Map<String, int> _lastSeq = {}; // session_id → last received seq

  WsClient({required this.serverUri, required this.deviceId, required this.getJwt});

  Stream<InnerMessage>       get messages => _msgCtrl.stream;
  Stream<WsConnectionState>  get states   => _stateCtrl.stream;
  Map<String, int>           get lastSeq  => Map.unmodifiable(_lastSeq);

  Future<void> connect() async {
    if (_disposed) return;
    _emit(WsConnectionState.connecting);
    try {
      final client = PinnedHttpClient.build();
      _ch = IOWebSocketChannel.connect(
        serverUri,
        customClient: client,
        pingInterval: const Duration(seconds: 30),
      );
      await _ch!.ready;
      _policy.reset();
      _sub = _ch!.stream.listen(
        _onFrame,
        onError: (_) => _scheduleRetry(),
        onDone: _scheduleRetry,
      );
      _emit(WsConnectionState.online);
      _sendAuthAttach();
    } catch (_) {
      _scheduleRetry();
    }
  }

  Future<void> send(InnerMessage msg) async {
    if (_ch == null) return;
    final plain = jsonEncode(msg.toJson());
    final sessionId = msg.payload['session_id'] as String? ?? '';
    final ciphertext = encrypt != null
        ? await encrypt!(plain, sessionId)
        : base64Url.encode(utf8.encode(plain)); // M1 stub: no actual encryption

    final env = Envelope(
      from: deviceId,
      to: '',
      sessionId: sessionId,
      seq: _nextSeq(sessionId),
      ts: DateTime.now().millisecondsSinceEpoch,
      sig: '', // signing added after Spike F1
      ciphertext: ciphertext,
    );
    _ch!.sink.add(_codec.encode(env.toJson()));
  }

  // Called by chat_provider when a session.event is received.
  void updateLastSeq(String sessionId, int seq) => _lastSeq[sessionId] = seq;

  Future<void> _onFrame(dynamic raw) async {
    for (final obj in _codec.decode(raw as String)) {
      try {
        final env  = Envelope.fromJson(obj);
        final text = decrypt != null
            ? await decrypt!(env.ciphertext, env.sessionId)
            : utf8.decode(base64Url.decode(env.ciphertext));
        final msg  = InnerMessage.fromJson(jsonDecode(text) as Map<String, dynamic>);
        if (env.sessionId.isNotEmpty) _lastSeq[env.sessionId] = env.seq;
        _msgCtrl.add(msg);
        if (msg.type == 'auth.token') _requestReplays();
        if (msg.type == 'replay.done') _emit(WsConnectionState.online);
      } catch (_) {
        // malformed frame; skip
      }
    }
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
      send(InnerMessage.create('session.replay', {'session_id': e.key, 'from_seq': e.value}));
    }
  }

  int _seqCounter = 0;
  int _nextSeq(String sessionId) => ++_seqCounter;

  void _scheduleRetry() {
    if (_disposed) return;
    _sub?.cancel();
    _ch?.sink.close();
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
    _ch?.sink.close();
    _msgCtrl.close();
    _stateCtrl.close();
  }
}
