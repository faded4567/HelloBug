import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'screens/startup_loading_page.dart';
import 'state/devices_provider.dart';
import 'transport/app_runtime_store.dart';
import 'transport/connection_state.dart';
import 'transport/ws_client.dart';
import 'transport/ws_provider.dart';

Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer();
  final runtime = await AppRuntimeStore.load();
  if (runtime != null) {
    final client = runtime.createClient();
    container.read(wsClientProvider.notifier).state = client;
    container.read(devicesProvider.notifier);

    runApp(
      UncontrolledProviderScope(
        container: container,
        child: _BootstrapGate(client: client, runtime: runtime),
      ),
    );
    return;
  }

  runApp(
    UncontrolledProviderScope(container: container, child: const HelloBugApp()),
  );
}

class _BootstrapGate extends StatefulWidget {
  const _BootstrapGate({required this.client, required this.runtime});
  final WsClient client;
  final AppRuntimeState runtime;

  @override
  State<_BootstrapGate> createState() => _BootstrapGateState();
}

class _BootstrapGateState extends State<_BootstrapGate> {
  bool _connected = false;
  String? _error;
  StreamSubscription<WsConnectionState>? _statesSub;

  @override
  void initState() {
    super.initState();
    _statesSub = widget.client.states.listen((s) {
      if (!mounted) return;
      if (s == WsConnectionState.online) {
        _connected = true;
        _error = null;
        if (mounted) setState(() {});
      } else if (s == WsConnectionState.offline && !_connected) {
        _error = null; // keep spinner, retrying
        if (mounted) setState(() {});
      } else if (s == WsConnectionState.authExpired) {
        _error = '认证已过期，请重新配对';
        if (mounted) setState(() {});
      }
    });
    unawaited(widget.client.connect());
    // Timeout: if still not connected after 15s, show error
    Future<void>.delayed(const Duration(seconds: 15), () {
      if (!mounted || _connected) return;
      setState(() {
        _error = '连接超时，请检查网络后重试';
      });
    });
  }

  @override
  void dispose() {
    _statesSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_connected) {
      return const HelloBugApp();
    }

    final runtime = widget.runtime;
    final host = Uri.tryParse(runtime.serverUrl)?.host ?? runtime.serverUrl;
    return CupertinoApp(
      debugShowCheckedModeBanner: false,
      theme: CupertinoThemeData(
        brightness: MediaQuery.platformBrightnessOf(context),
      ),
      home: StartupLoadingPage(
        relayUrl: host,
        pairedDeviceName: runtime.machineName,
        lastActiveText: null, // TODO: compute from persisted lastSeen
        error: _error,
        onRetry: () {
          setState(() => _error = null);
          unawaited(widget.client.connect());
        },
        onEnterOffline: () {
          setState(() => _connected = true);
        },
        onGoToOnboarding: () async {
          await AppRuntimeStore.clear();
          widget.client.dispose();
          setState(() => _connected = true);
          // Will result in HelloBugApp with null client → onboarding
        },
      ),
    );
  }
}
