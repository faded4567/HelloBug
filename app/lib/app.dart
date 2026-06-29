import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'models/inner_message.dart';
import 'router.dart';
import 'screens/unlock/unlock_gate.dart';
import 'state/chat_provider.dart';
import 'state/danger_pending_provider.dart';
import 'state/danger_result_provider.dart';
import 'state/devices_provider.dart';
import 'state/drafts_provider.dart';
import 'state/sessions_provider.dart';
import 'state/workspaces_provider.dart';
import 'theme/index.dart';
import 'transport/app_runtime_store.dart';
import 'transport/push_token_bridge.dart';
import 'transport/transport_lifecycle_observer.dart';
import 'transport/ws_client.dart';
import 'transport/ws_provider.dart';
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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      unawaited(PushTokenBridge.start(ref));
    });
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
      builder:
          (context, child) => UnlockGate(
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
  StreamSubscription<InnerMessage>? _transportSub;
  WsClient? _observedClient;
  String? _lastUploadedPushTokenKey;
  bool _resettingRuntime = false;

  @override
  void dispose() {
    _transportSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final client = ref.watch(wsClientProvider);
    _bindTransportClient(client);

    ref.listen<String?>(pushTokenProvider, (_, __) {
      unawaited(_maybeUploadPushToken());
    });

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
          builder:
              (_) => CupertinoAlertDialog(
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

  void _bindTransportClient(WsClient? client) {
    if (identical(client, _observedClient)) {
      return;
    }

    _transportSub?.cancel();
    _observedClient = client;
    _lastUploadedPushTokenKey = null;
    if (client == null) {
      return;
    }

    _transportSub = client.messages.listen((message) {
      if (message.type == 'auth.token') {
        unawaited(_maybeUploadPushToken(force: true));
        return;
      }
      if (message.type == 'error') {
        unawaited(_handleTransportError(message));
      }
    });

    if (client.isAuthenticated) {
      unawaited(_maybeUploadPushToken(force: true));
    }
  }

  Future<void> _maybeUploadPushToken({bool force = false}) async {
    final client = _observedClient;
    final token = ref.read(pushTokenProvider)?.trim();
    if (client == null ||
        !client.isAuthenticated ||
        token == null ||
        token.isEmpty) {
      return;
    }

    final payload = _buildPushTokenPayload(token);
    if (payload == null) {
      return;
    }

    final uploadKey =
        '${client.deviceId}:${payload['platform'] as String}:$token';
    if (!force && uploadKey == _lastUploadedPushTokenKey) {
      return;
    }

    try {
      await client.send(InnerMessage.create('device.push_token', payload));
      _lastUploadedPushTokenKey = uploadKey;
      debugPrint(
        '[TransportRuntime] push token uploaded platform=${payload['platform']}',
      );
    } catch (error) {
      debugPrint('[TransportRuntime] push token upload failed -> $error');
    }
  }

  Map<String, dynamic>? _buildPushTokenPayload(String token) {
    if (kIsWeb) {
      return null;
    }

    switch (defaultTargetPlatform) {
      case TargetPlatform.iOS:
        return {
          'platform': 'ios',
          'apns_token': token,
          'manufacturer': null,
          'vendor_token': null,
        };
      case TargetPlatform.android:
        return {
          'platform': 'android',
          'apns_token': null,
          'manufacturer': 'Other',
          'vendor_token': token,
        };
      default:
        return null;
    }
  }

  Future<void> _handleTransportError(InnerMessage message) async {
    final code = message.payload['code'] as String? ?? '';
    final requestId = message.payload['request_id'] as String? ?? '';
    final errorMessage = message.payload['message'] as String? ?? '连接已失效';

    if (code == 'DEVICE_REVOKED') {
      await _resetRuntimeAndReturnToOnboarding(
        title: '设备已吊销',
        message: errorMessage,
      );
      return;
    }

    if (code == 'AUTH_INVALID' &&
        (requestId == 'auth.attach' || requestId == 'auth.refresh')) {
      await _resetRuntimeAndReturnToOnboarding(
        title: '登录已失效',
        message: errorMessage,
      );
    }
  }

  Future<void> _resetRuntimeAndReturnToOnboarding({
    required String title,
    required String message,
  }) async {
    if (_resettingRuntime) {
      return;
    }
    _resettingRuntime = true;

    try {
      final client = _observedClient;
      _transportSub?.cancel();
      _transportSub = null;
      _observedClient = null;
      _lastUploadedPushTokenKey = null;

      ref.read(wsClientProvider.notifier).state = null;
      client?.dispose();
      await AppRuntimeStore.clear();
      ref.read(devicesProvider.notifier).clear();
      ref.read(sessionsProvider.notifier).clear();
      ref.invalidate(chatProvider);
      ref.invalidate(draftsProvider);
      ref.invalidate(workspacesProvider);

      if (!mounted) {
        return;
      }

      await showCupertinoDialog<void>(
        context: context,
        builder:
            (dialogContext) => CupertinoAlertDialog(
              title: Text(title),
              content: Text(message),
              actions: [
                CupertinoDialogAction(
                  onPressed:
                      () =>
                          Navigator.of(
                            dialogContext,
                            rootNavigator: true,
                          ).pop(),
                  child: const Text('重新配对'),
                ),
              ],
            ),
      );
      if (!mounted) {
        return;
      }
      context.go('/onboarding');
    } finally {
      _resettingRuntime = false;
    }
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
