import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'ws_provider.dart';

class TransportLifecycleObserver extends WidgetsBindingObserver {
  final WidgetRef _ref;
  TransportLifecycleObserver(this._ref);

  void attach() => WidgetsBinding.instance.addObserver(this);
  void detach() => WidgetsBinding.instance.removeObserver(this);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _ref.read(wsClientProvider)?.reconnectIfNeeded();
    }
  }
}
