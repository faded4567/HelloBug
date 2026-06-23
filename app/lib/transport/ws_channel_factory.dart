import 'ws_channel_factory_stub.dart'
    if (dart.library.io) 'ws_channel_factory_io.dart'
    if (dart.library.js_interop) 'ws_channel_factory_web.dart' as impl;

abstract interface class PlatformWsSocket {
  Future<void> get ready;
  Stream<dynamic> get stream;
  void sendText(String text);
  Future<void> close();
}

PlatformWsSocket createPlatformWebSocketChannel(Uri uri) =>
    impl.createPlatformWebSocketChannel(uri);
