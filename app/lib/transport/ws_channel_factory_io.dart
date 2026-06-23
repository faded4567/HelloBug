import 'package:web_socket_channel/io.dart';

import 'ws_channel_factory.dart';

class _IoPlatformWsSocket implements PlatformWsSocket {
  _IoPlatformWsSocket(this._channel);

  final IOWebSocketChannel _channel;

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
    _IoPlatformWsSocket(IOWebSocketChannel.connect(uri));
