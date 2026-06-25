import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'screens/unlock/unlock_gate.dart';
import 'state/danger_pending_provider.dart';
import 'state/danger_result_provider.dart';
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

class _DangerListener extends ConsumerStatefulWidget {
  const _DangerListener({required this.child});
  final Widget child;

  @override
  ConsumerState<_DangerListener> createState() => _DangerListenerState();
}

class _DangerListenerState extends ConsumerState<_DangerListener> {
  final Set<String> _activeDangerIds = <String>{};
  final Set<String> _announcedDangerResultIds = <String>{};

  @override
  Widget build(BuildContext context) {
    ref.listen(dangerPendingProvider, (_, next) {
      next.whenData((req) {
        if (_activeDangerIds.contains(req.dangerId)) {
          return;
        }

        _activeDangerIds.add(req.dangerId);
        showCupertinoModalPopup<void>(
          context: context,
          builder: (_) => DangerConfirmSheet(request: req),
        ).whenComplete(() {
          _activeDangerIds.remove(req.dangerId);
        });
      });
    });

    ref.listen(dangerResultProvider, (_, next) {
      next.whenData((result) {
        if (!result.shouldAlertGlobally) {
          return;
        }
        if (_activeDangerIds.contains(result.dangerId)) {
          return;
        }
        if (_announcedDangerResultIds.contains(result.dangerId)) {
          return;
        }

        _announcedDangerResultIds.add(result.dangerId);
        showCupertinoDialog<void>(
          context: context,
          builder: (_) => CupertinoAlertDialog(
            title: Text(_dangerResultTitle(result.status)),
            content: Text(result.message),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('知道了'),
              ),
            ],
          ),
        );
      });
    });

    return widget.child;
  }

  String _dangerResultTitle(String status) {
    switch (status) {
      case 'timed_out':
        return '危险操作已超时';
      case 'not_found':
        return '危险操作已失效';
      case 'biometric_required':
        return '需要生物验证';
      default:
        return '危险操作未完成';
    }
  }
}
