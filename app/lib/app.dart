import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'screens/unlock/unlock_gate.dart';
import 'state/danger_pending_provider.dart';
import 'theme/index.dart';
import 'transport/transport_lifecycle_observer.dart';
import 'widgets/danger_confirm/danger_confirm_sheet.dart';

class HelloBugApp extends ConsumerStatefulWidget {
  const HelloBugApp({super.key});

  @override
  ConsumerState<HelloBugApp> createState() => _HelloBugAppState();
}

class _HelloBugAppState extends ConsumerState<HelloBugApp> {
  late final TransportLifecycleObserver _transportObserver;

  @override
  void initState() {
    super.initState();
    _transportObserver = TransportLifecycleObserver(ref)..attach();
  }

  @override
  void dispose() {
    _transportObserver.detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeModeProvider);
    final isDark =
        themeMode == AppThemeMode.dark ||
        (themeMode == AppThemeMode.system &&
            MediaQuery.platformBrightnessOf(context) == Brightness.dark);

    return CupertinoApp.router(
      title: 'HelloBug',
      theme: isDark ? AppTheme.dark() : AppTheme.light(),
      routerConfig: router,
      debugShowCheckedModeBanner: false,
      localizationsDelegates: const [
        DefaultCupertinoLocalizations.delegate,
        DefaultWidgetsLocalizations.delegate,
      ],
      builder: (context, child) => UnlockGate(
        child: _DangerListener(child: child ?? const SizedBox.shrink()),
      ),
    );
  }
}

class _DangerListener extends ConsumerWidget {
  const _DangerListener({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(dangerPendingProvider, (_, next) {
      next.whenData((req) {
        showCupertinoModalPopup<void>(
          context: context,
          builder: (_) => DangerConfirmSheet(request: req),
        );
      });
    });
    return child;
  }
}
