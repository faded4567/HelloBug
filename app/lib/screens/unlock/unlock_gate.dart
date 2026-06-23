import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'unlock_controller.dart';
import 'unlock_page.dart';

// Intercepts navigation: shows UnlockPage when locked, otherwise renders child.
class UnlockGate extends ConsumerWidget {
  static const _debugSkipUnlock = bool.fromEnvironment(
    'HELLOBUG_DEBUG_SKIP_UNLOCK',
  );

  final Widget child;
  const UnlockGate({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (kDebugMode && _debugSkipUnlock) {
      return child;
    }
    final locked = ref.watch(unlockControllerProvider);
    return locked ? const UnlockPage() : child;
  }
}
