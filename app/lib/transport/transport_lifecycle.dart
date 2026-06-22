import 'package:flutter/widgets.dart';
import 'ws_client.dart';

// Reconnects the WebSocket when the app returns to foreground.
// Attach/detach in bootstrap; separate from AppLifecycleObserver (lock concern).
class TransportLifecycleObserver extends WidgetsBindingObserver {
  TransportLifecycleObserver(this._client);
  final WsClient _client;

  void attach() => WidgetsBinding.instance.addObserver(this);
  void detach() => WidgetsBinding.instance.removeObserver(this);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _client.reconnectIfNeeded();
  }
}
