import 'dart:async';
import 'dart:js_interop';

import 'package:flutter/foundation.dart';
import 'package:web/web.dart' as web;

import 'ws_channel_factory.dart';

class _WebPlatformWsSocket implements PlatformWsSocket {
  _WebPlatformWsSocket(Uri uri) : _socket = web.WebSocket(uri.toString()) {
    debugPrint('[WsFactory] web -> $uri');
    _socket.binaryType = 'arraybuffer';

    if (_socket.readyState == web.WebSocket.OPEN) {
      _ready.complete();
    } else {
      _socket.onOpen.first.then((_) {
        if (!_ready.isCompleted) {
          _ready.complete();
        }
      });
    }

    _socket.onMessage.listen((event) {
      if (_events.isClosed) {
        return;
      }

      final data = event.data;
      if (data.typeofEquals('string')) {
        _events.add((data as JSString).toDart);
        return;
      }
      if (data.typeofEquals('object') &&
          (data as JSObject).instanceOfString('ArrayBuffer')) {
        _events.add((data as JSArrayBuffer).toDart.asUint8List());
        return;
      }
      _events.add(data.toString());
    });

    _socket.onError.first.then((_) {
      final error = StateError('WebSocket connection failed');
      if (!_ready.isCompleted) {
        _ready.completeError(error);
      }
      if (!_events.isClosed) {
        _events.addError(error);
      }
    });

    _socket.onClose.first.then((_) async {
      if (!_ready.isCompleted) {
        _ready.complete();
      }
      if (!_events.isClosed) {
        await _events.close();
      }
    });
  }

  final web.WebSocket _socket;
  final Completer<void> _ready = Completer<void>();
  final StreamController<dynamic> _events = StreamController<dynamic>();

  @override
  Future<void> get ready => _ready.future;

  @override
  Stream<dynamic> get stream => _events.stream;

  @override
  void sendText(String text) {
    _socket.send(text.toJS);
  }

  @override
  Future<void> close() async {
    if (!_events.isClosed) {
      await _events.close();
    }
    final state = _socket.readyState;
    if (state == web.WebSocket.OPEN || state == web.WebSocket.CONNECTING) {
      _socket.close();
    }
  }
}

PlatformWsSocket createPlatformWebSocketChannel(Uri uri) =>
    _WebPlatformWsSocket(uri);
