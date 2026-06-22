import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'unlock_controller.dart';

// Locks the app when it has been backgrounded for more than [_timeout].
class AppLifecycleObserver extends WidgetsBindingObserver {
  static const _timeout = Duration(minutes: 5);

  final WidgetRef _ref;
  DateTime? _pausedAt;

  AppLifecycleObserver(this._ref);

  void attach() => WidgetsBinding.instance.addObserver(this);
  void detach() => WidgetsBinding.instance.removeObserver(this);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        _pausedAt = DateTime.now();
      case AppLifecycleState.resumed:
        final paused = _pausedAt;
        if (paused != null && DateTime.now().difference(paused) >= _timeout) {
          _ref.read(unlockControllerProvider.notifier).lock();
        }
        _pausedAt = null;
      default:
        break;
    }
  }
}
