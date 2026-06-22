import 'dart:async';

// Sends WebSocket ping every 30 s; fires onTimeout if no pong within 60 s.
class Heartbeat {
  static const _interval = Duration(seconds: 30);
  static const _timeout  = Duration(seconds: 60);

  final void Function() onSendPing;
  final void Function() onTimeout;

  Timer? _ticker;
  Timer? _pongDeadline;

  Heartbeat({required this.onSendPing, required this.onTimeout});

  void start() {
    _ticker = Timer.periodic(_interval, (_) {
      onSendPing();
      _pongDeadline = Timer(_timeout, () {
        stop();
        onTimeout();
      });
    });
  }

  void pongReceived() {
    _pongDeadline?.cancel();
    _pongDeadline = null;
  }

  void stop() {
    _ticker?.cancel();
    _pongDeadline?.cancel();
    _ticker = null;
    _pongDeadline = null;
  }
}
