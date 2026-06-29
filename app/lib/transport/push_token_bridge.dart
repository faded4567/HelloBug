import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'ws_provider.dart';

class PushTokenBridge {
  PushTokenBridge._();

  static const MethodChannel _methods = MethodChannel(
    'hellobug.push_token/methods',
  );
  static const EventChannel _events = EventChannel(
    'hellobug.push_token/events',
  );

  static StreamSubscription<dynamic>? _subscription;
  static bool _started = false;

  static Future<void> start(WidgetRef ref) async {
    if (_started) {
      return;
    }

    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.iOS &&
            defaultTargetPlatform != TargetPlatform.android)) {
      return;
    }

    try {
      _subscription = _events.receiveBroadcastStream().listen((dynamic token) {
        final normalized = token is String ? token.trim() : '';
        if (normalized.isEmpty) {
          return;
        }
        ref.read(pushTokenProvider.notifier).state = normalized;
        debugPrint('[PushTokenBridge] token updated from platform bridge');
      });

      final initial = await _methods.invokeMethod<String>('initialize');
      final normalized = initial?.trim() ?? '';
      if (normalized.isNotEmpty) {
        ref.read(pushTokenProvider.notifier).state = normalized;
        debugPrint('[PushTokenBridge] initial token received');
      }
      _started = true;
    } on MissingPluginException catch (_) {
      await _subscription?.cancel();
      _subscription = null;
      debugPrint('[PushTokenBridge] platform bridge missing');
    } catch (error) {
      await _subscription?.cancel();
      _subscription = null;
      debugPrint('[PushTokenBridge] start failed -> $error');
    }
  }

  static Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
    _started = false;
  }
}
