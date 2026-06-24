import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'state/devices_provider.dart';
import 'transport/app_runtime_store.dart';
import 'transport/ws_provider.dart';

Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer();
  final runtime = await AppRuntimeStore.load();
  if (runtime != null) {
    final client = runtime.createClient();
    container.read(wsClientProvider.notifier).state = client;
    container.read(devicesProvider.notifier);
    unawaited(client.connect());
  }

  runApp(
    UncontrolledProviderScope(container: container, child: const HelloBugApp()),
  );
}
