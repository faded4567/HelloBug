import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/device_summary.dart';
import '../transport/app_runtime_store.dart';
import '../transport/ws_provider.dart';

final devicesProvider =
    NotifierProvider<DevicesNotifier, Map<String, DeviceSummary>>(
      DevicesNotifier.new,
    );

class DevicesNotifier extends Notifier<Map<String, DeviceSummary>> {
  StreamSubscription? _messagesSub;
  bool _restoredPersistedDevice = false;
  Map<String, DeviceSummary> _devices = const {};

  @override
  Map<String, DeviceSummary> build() {
    final client = ref.watch(wsClientProvider);
    _messagesSub?.cancel();
    if (client != null) {
      _messagesSub = client.messages.listen((msg) {
        if (msg.type == 'device.status') {
          final d = DeviceSummary.fromStatusPayload(msg.payload);
          debugPrint(
            '[Devices] status device=${d.deviceId} online=${d.online} machine=${d.machineName}',
          );
          unawaited(
            AppRuntimeStore.persistPairedDaemon(
              daemonDeviceId: d.deviceId,
              machineName: d.machineName,
            ),
          );
          upsert(d);
        }
      });
    }
    if (!_restoredPersistedDevice) {
      _restoredPersistedDevice = true;
      unawaited(_restorePersistedDevice());
    }
    ref.onDispose(() => _messagesSub?.cancel());
    return _devices;
  }

  void upsert(DeviceSummary device) {
    _devices = {..._devices, device.deviceId: device};
    state = _devices;
  }

  Future<void> _restorePersistedDevice() async {
    final runtime = await AppRuntimeStore.load();
    if (runtime == null ||
        runtime.pairedDaemonId == null ||
        runtime.machineName == null) {
      return;
    }
    if (_devices.containsKey(runtime.pairedDaemonId)) {
      return;
    }
    final restored = DeviceSummary(
      deviceId: runtime.pairedDaemonId!,
      machineName: runtime.machineName!,
      os: runtime.os ?? '',
      online: false,
    );
    debugPrint(
      '[Devices] restored persisted device=${restored.deviceId} machine=${restored.machineName}',
    );
    upsert(restored);
  }
}
