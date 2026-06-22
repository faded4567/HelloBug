import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'unlock_controller.dart';
import 'unlock_page.dart';

// Intercepts navigation: shows UnlockPage when locked, otherwise renders child.
class UnlockGate extends ConsumerWidget {
  final Widget child;
  const UnlockGate({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locked = ref.watch(unlockControllerProvider);
    return locked ? const UnlockPage() : child;
  }
}
