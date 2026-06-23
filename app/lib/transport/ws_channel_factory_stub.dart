import 'package:web_socket_channel/web_socket_channel.dart';

import 'ws_channel_factory.dart';

class _ChannelPlatformWsSocket implements PlatformWsSocket {
  _ChannelPlatformWsSocket(this._channel);

  final WebSocketChannel _channel;

  @override
  Future<void> get ready => _channel.ready;

  @override
  Stream<dynamic> get stream => _channel.stream;

  @override
  void sendText(String text) {
    _channel.sink.add(text);
  }

  @override
  Future<void> close() => _channel.sink.close();
}

PlatformWsSocket createPlatformWebSocketChannel(Uri uri) =>
    _ChannelPlatformWsSocket(WebSocketChannel.connect(uri));
