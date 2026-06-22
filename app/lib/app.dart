import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'screens/unlock/app_lifecycle_observer.dart';
import 'theme/index.dart';

class HelloBugApp extends ConsumerStatefulWidget {
  const HelloBugApp({super.key});

  @override
  ConsumerState<HelloBugApp> createState() => _HelloBugAppState();
}

class _HelloBugAppState extends ConsumerState<HelloBugApp> {
  late final AppLifecycleObserver _lifecycleObserver;

  @override
  void initState() {
    super.initState();
    _lifecycleObserver = AppLifecycleObserver(ref)..attach();
  }

  @override
  void dispose() {
    _lifecycleObserver.detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router    = ref.watch(routerProvider);
    final themeMode = ref.watch(themeModeProvider);
    final isDark    = themeMode == AppThemeMode.dark ||
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
    );
  }
}
