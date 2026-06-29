import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/device_summary.dart';
import '../models/inner_message.dart';
import '../transport/app_runtime_store.dart';
import '../transport/ws_client.dart';
import '../transport/ws_provider.dart';

final devicesProvider =
    NotifierProvider<DevicesNotifier, Map<String, DeviceSummary>>(
      DevicesNotifier.new,
    );

class DeviceRevokeResult {
  const DeviceRevokeResult({
    required this.deviceId,
    required this.mode,
    required this.disconnected,
    this.revokedAt,
  });

  final String deviceId;
  final String mode;
  final bool disconnected;
  final DateTime? revokedAt;
}

class DevicesNotifier extends Notifier<Map<String, DeviceSummary>> {
  StreamSubscription<InnerMessage>? _messagesSub;
  WsClient? _lastClient;
  bool _restoredPersistedDevice = false;
  bool _loading = false;
  bool _loadedRemote = false;
  Map<String, DeviceSummary> _devices = const {};

  @override
  Map<String, DeviceSummary> build() {
    final client = ref.watch(wsClientProvider);
    if (!identical(client, _lastClient)) {
      _lastClient = client;
      _loadedRemote = false;
      _messagesSub?.cancel();
      if (client != null) {
        _messagesSub = client.messages.listen(_handleMessage);
        unawaited(load(force: true));
      }
    }
    if (!_restoredPersistedDevice) {
      _restoredPersistedDevice = true;
      unawaited(_restorePersistedDevice());
    }
    ref.onDispose(() => _messagesSub?.cancel());
    return _devices;
  }

  Future<void> load({bool force = false}) async {
    final client = _lastClient ?? ref.read(wsClientProvider);
    if (client == null || _loading || (_loadedRemote && !force)) {
      return;
    }

    _loading = true;
    try {
      final request = InnerMessage.create('device.list', const {});
      final response = client.messages
          .firstWhere(
            (message) =>
                (message.type == 'device.list' && message.id == request.id) ||
                (message.type == 'error' &&
                    message.payload['request_id'] == request.id),
          )
          .timeout(const Duration(seconds: 5));
      await client.send(request);
      final msg = await response;
      if (msg.type == 'error') {
        throw StateError(msg.payload['message'] as String? ?? '设备列表读取失败');
      }

      final nextDevices = DeviceSummary.listFromPayload(msg.payload['devices']);
      _setDevices({for (final device in nextDevices) device.deviceId: device});
      _loadedRemote = true;
    } catch (error) {
      debugPrint('[Devices] load failed -> $error');
    } finally {
      _loading = false;
    }
  }

  Future<void> refresh() => load(force: true);

  void upsert(DeviceSummary device) {
    final existing = _devices[device.deviceId];
    final merged = existing?.merge(device) ?? device;
    _setDevices({..._devices, device.deviceId: merged});
  }

  Future<DeviceSummary> renameDevice(
    String deviceId,
    String machineName,
  ) async {
    final normalizedName = machineName.trim();
    if (normalizedName.isEmpty) {
      throw StateError('设备名称不能为空');
    }

    final client = _lastClient ?? ref.read(wsClientProvider);
    if (client == null) {
      throw StateError('未连接到服务器');
    }

    final request = InnerMessage.create('device.rename', {
      'device_id': deviceId,
      'machine_name': normalizedName,
    });
    final response = client.messages
        .firstWhere(
          (message) =>
              (message.type == 'device.rename' && message.id == request.id) ||
              (message.type == 'error' &&
                  message.payload['request_id'] == request.id),
        )
        .timeout(const Duration(seconds: 5));
    await client.send(request);
    final msg = await response;
    if (msg.type == 'error') {
      throw StateError(msg.payload['message'] as String? ?? '设备重命名失败');
    }

    final payload = msg.payload['device'];
    if (payload is! Map) {
      throw const FormatException('device.rename 响应格式错误');
    }
    final renamed = DeviceSummary.fromListPayload(
      payload.map((key, value) => MapEntry('$key', value)),
    );
    upsert(renamed);
    await AppRuntimeStore.persistPairedDaemon(
      daemonDeviceId: renamed.deviceId,
      machineName: renamed.machineName,
      os: renamed.os.isNotEmpty ? renamed.os : null,
    );
    return _devices[renamed.deviceId] ?? renamed;
  }

  Future<DeviceRevokeResult> revokeDevice(
    String deviceId, {
    required String mode,
  }) async {
    final client = _lastClient ?? ref.read(wsClientProvider);
    if (client == null) {
      throw StateError('未连接到服务器');
    }

    final request = InnerMessage.create('device.revoke', {
      'device_id': deviceId,
      'mode': mode,
    });
    final response = client.messages
        .firstWhere(
          (message) =>
              (message.type == 'device.revoke' && message.id == request.id) ||
              (message.type == 'error' &&
                  message.payload['request_id'] == request.id),
        )
        .timeout(const Duration(seconds: 5));
    await client.send(request);
    final msg = await response;
    if (msg.type == 'error') {
      throw StateError(msg.payload['message'] as String? ?? '设备操作失败');
    }

    final revokedMode = msg.payload['mode'] as String? ?? mode;
    final revokedAt = _dateFromEpochMs(msg.payload['revoked_at']);
    final disconnected = msg.payload['disconnected'] as bool? ?? false;

    if (revokedMode == 'unlink') {
      remove(deviceId);
    } else {
      final current = _devices[deviceId];
      if (current != null) {
        upsert(
          current.copyWith(
            online: false,
            activeSessions: 0,
            revokedAt: revokedAt ?? DateTime.now(),
          ),
        );
      }
    }

    return DeviceRevokeResult(
      deviceId: deviceId,
      mode: revokedMode,
      revokedAt: revokedAt,
      disconnected: disconnected,
    );
  }

  void remove(String deviceId) {
    if (!_devices.containsKey(deviceId)) {
      return;
    }
    final next = Map<String, DeviceSummary>.from(_devices)..remove(deviceId);
    _setDevices(next);
  }

  void clear() {
    _setDevices(const {});
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

  void _handleMessage(InnerMessage msg) {
    if (msg.type != 'device.status') {
      return;
    }
    final device = DeviceSummary.fromStatusPayload(msg.payload);
    debugPrint(
      '[Devices] status device=${device.deviceId} online=${device.online} machine=${device.machineName}',
    );
    unawaited(
      AppRuntimeStore.persistPairedDaemon(
        daemonDeviceId: device.deviceId,
        machineName: device.machineName,
        os: device.os.isNotEmpty ? device.os : null,
      ),
    );
    final existing = _devices[device.deviceId];
    final merged = existing?.mergePresence(device) ?? device;
    _setDevices({..._devices, device.deviceId: merged});
  }

  void _setDevices(Map<String, DeviceSummary> next) {
    _devices = next;
    state = next;
  }
}

DateTime? _dateFromEpochMs(Object? raw) {
  final value = (raw as num?)?.toInt();
  if (value == null || value <= 0) {
    return null;
  }
  return DateTime.fromMillisecondsSinceEpoch(value);
}
