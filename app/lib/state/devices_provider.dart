import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/device_summary.dart';
import '../transport/ws_provider.dart';

final devicesProvider =
    NotifierProvider<DevicesNotifier, Map<String, DeviceSummary>>(DevicesNotifier.new);

class DevicesNotifier extends Notifier<Map<String, DeviceSummary>> {
  @override
  Map<String, DeviceSummary> build() {
    final client = ref.watch(wsClientProvider);
    if (client != null) {
      final sub = client.messages.listen((msg) {
        if (msg.type == 'device.status') {
          final d = DeviceSummary.fromStatusPayload(msg.payload);
          state = {...state, d.deviceId: d};
        }
      });
      ref.onDispose(sub.cancel);
    }
    return {};
  }

  void upsert(DeviceSummary device) => state = {...state, device.deviceId: device};
}
