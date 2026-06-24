import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:xterm/xterm.dart';
import '../../models/inner_message.dart';
import '../../transport/ws_client.dart';

class PtySessionController extends ChangeNotifier {
  PtySessionController({required this.sessionId, required this.wsClient});

  final String sessionId;
  final WsClient wsClient;

  final terminal = Terminal(maxLines: 10000);
  final terminalCtrl = TerminalController();

  StreamSubscription? _sub;

  void start() {
    terminal.onOutput = (data) {
      wsClient.send(
        InnerMessage.create('pty.input', {
          'session_id': sessionId,
          'data': base64Encode(utf8.encode(data)),
        }),
      );
    };
    terminal.onResize = (width, height, _, __) {
      if (width > 0 && height > 0) {
        sendResize(width, height);
      }
    };

    _sub = wsClient.messages.listen((msg) {
      if (msg.type != 'session.event') return;
      if (msg.payload['session_id'] != sessionId) return;
      final event = msg.payload['event'];
      if (event is! Map) return;
      if (event['event_type'] != 'pty.data') return;
      final raw = event['bytes'] as String? ?? '';
      if (raw.isEmpty) return;
      terminal.write(utf8.decode(base64Decode(raw), allowMalformed: true));
    });
  }

  void sendResize(int cols, int rows) {
    wsClient.send(
      InnerMessage.create('pty.resize', {
        'session_id': sessionId,
        'cols': cols,
        'rows': rows,
      }),
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
