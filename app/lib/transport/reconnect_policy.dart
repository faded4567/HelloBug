import 'dart:math';

class ReconnectPolicy {
  static const _base = Duration(seconds: 1);
  static const _cap  = Duration(seconds: 30);

  int _attempt = 0;

  Duration next() {
    final ms = min(
      _cap.inMilliseconds,
      _base.inMilliseconds * (1 << _attempt),
    );
    _attempt++;
    return Duration(milliseconds: ms);
  }

  void reset() => _attempt = 0;
}
