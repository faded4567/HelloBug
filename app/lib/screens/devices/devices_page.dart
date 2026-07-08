import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/device_summary.dart';
import '../../state/devices_provider.dart';
import '../../state/sessions_provider.dart';
import '../../theme/index.dart';
import '../../transport/app_runtime_store.dart';
import '../../transport/ws_provider.dart';

class DevicesPage extends ConsumerStatefulWidget {
  const DevicesPage({super.key});

  @override
  ConsumerState<DevicesPage> createState() => _DevicesPageState();
}

class _DevicesPageState extends ConsumerState<DevicesPage> {
  bool _initialLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Mark initial loading done after first build with data
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() => _initialLoading = false);
    });
  }

  Future<void> _refresh() async {
    setState(() => _error = null);
    final client = ref.read(wsClientProvider);
    if (client == null) {
      setState(() => _error = '未连接到服务器');
      return;
    }
    try {
      await ref.read(devicesProvider.notifier).load(force: true);
      setState(() => _error = null);
    } catch (e) {
      setState(() => _error = '刷新失败，请稍后再试');
    }
  }

  Future<bool> _confirmUnlink(DeviceSummary device) async {
    final result = await showCupertinoDialog<bool>(
      context: context,
      builder:
          (dialogContext) => CupertinoAlertDialog(
            title: Text('解绑 ${device.machineName}'),
            content: const Text('解绑后 App 将断开连接并返回配对流程。'),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('取消'),
              ),
              CupertinoDialogAction(
                isDestructiveAction: true,
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('解绑'),
              ),
            ],
          ),
    );
    return result ?? false;
  }

  Future<void> _unlinkDevice(DeviceSummary device) async {
    try {
      await ref
          .read(devicesProvider.notifier)
          .revokeDevice(device.deviceId, mode: 'unlink');
    } catch (_) {
      // Still clean up local state even if remote call fails
    }
    final client = ref.read(wsClientProvider);
    ref.read(wsClientProvider.notifier).state = null;
    client?.dispose();
    ref.read(devicesProvider.notifier).clear();
    ref.read(sessionsProvider.notifier).clear();
    await AppRuntimeStore.clear();
    if (mounted) {
      context.go('/onboarding');
    }
  }

  @override
  Widget build(BuildContext context) {
    final devices =
        ref.watch(devicesProvider).values.toList()..sort((left, right) {
          if (left.isRevoked != right.isRevoked) {
            return left.isRevoked ? 1 : -1;
          }
          if (left.online != right.online) {
            return left.online ? -1 : 1;
          }
          return left.machineName.toLowerCase().compareTo(
            right.machineName.toLowerCase(),
          );
        });
    final c = context.colors;

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('我的设备', style: TextStyle(color: c.fg)),
        trailing: GestureDetector(
          onTap: () => context.push('/settings'),
          child: Icon(CupertinoIcons.settings, color: c.tint),
        ),
      ),
      child: SafeArea(
        child: _buildContent(devices, c),
      ),
    );
  }

  Widget _buildContent(List<DeviceSummary> devices, ThemeColors c) {
    // Initial loading state
    if (_initialLoading && devices.isEmpty) {
      return const Center(child: CupertinoActivityIndicator());
    }

    // Error state
    if (_error != null && devices.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('📡', style: TextStyle(fontSize: 52)),
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: c.fg2),
              ),
              const SizedBox(height: 16),
              CupertinoButton.filled(
                onPressed: _refresh,
                child: const Text('重试'),
              ),
            ],
          ),
        ),
      );
    }

    // Empty state (no paired devices)
    if (devices.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('🖥', style: TextStyle(fontSize: 52, color: c.fg3.withValues(alpha: .25))),
              const SizedBox(height: 12),
              Text(
                '还没有配对设备',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.fg),
              ),
              const SizedBox(height: 8),
              Text(
                '首次使用需要先在电脑上运行 daemon\n然后扫码或输入配对码绑定',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: c.fg2, height: 1.6),
              ),
              const SizedBox(height: 16),
              CupertinoButton.filled(
                onPressed: () => context.push('/pairing'),
                child: const Text('绑定新设备'),
              ),
            ],
          ),
        ),
      );
    }

    // Device list
    return Column(
      children: [
        // Error banner (non-blocking)
        if (_error != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: AppColors.red.withValues(alpha: .12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _error!,
                    style: TextStyle(fontSize: 13, color: AppColors.red),
                  ),
                ),
                GestureDetector(
                  onTap: _refresh,
                  child: Text('重试', style: TextStyle(fontSize: 13, color: c.tint)),
                ),
              ],
            ),
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            children: [
              _SectionHeader(label: '已配对'),
              ...devices.map(
                (d) => Dismissible(
                  key: Key('device-${d.deviceId}'),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 20),
                    margin: const EdgeInsets.only(bottom: 8),
                    decoration: BoxDecoration(
                      color: AppColors.red,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Text(
                      '解绑',
                      style: TextStyle(
                        color: CupertinoColors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  confirmDismiss: (_) => _confirmUnlink(d),
                  onDismissed: (_) => _unlinkDevice(d),
                  child: _DeviceCard(device: d),
                ),
              ),
              _SectionHeader(label: '添加'),
              _AddDeviceRow(onTap: () => context.push('/pairing')),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                decoration: BoxDecoration(
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: '💡 '),
                      TextSpan(
                        text: '向左滑动',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: c.fg,
                        ),
                      ),
                      TextSpan(
                        text: '卡片可解绑设备并吊销其访问权限',
                        style: TextStyle(color: c.fg2),
                      ),
                    ],
                  ),
                  style: const TextStyle(fontSize: 13, height: 1.6),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 8, left: 4),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: context.colors.fg2,
          letterSpacing: .5,
        ),
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({required this.device});
  final DeviceSummary device;

  @override
  Widget build(BuildContext context) {
    final lastSeenMins =
        device.lastSeen != null
            ? DateTime.now().difference(device.lastSeen!).inMinutes
            : null;
    final statusColor =
        device.isRevoked
            ? AppColors.red
            : device.online
            ? AppColors.green
            : context.colors.fg3;
    final statusText =
        device.isRevoked
            ? '已吊销'
            : device.online
            ? '在线'
            : '离线';
    return GestureDetector(
      onTap: () => context.push('/device/${device.deviceId}', extra: device),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: context.colors.bg2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  device.online ? '💻' : '🖥',
                  style: const TextStyle(fontSize: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    device.machineName,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: context.colors.fg,
                    ),
                  ),
                ),
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: statusColor,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  statusText,
                  style: TextStyle(fontSize: 13, color: statusColor),
                ),
              ],
            ),
            if (device.os.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                device.os,
                style: TextStyle(fontSize: 13, color: context.colors.fg2),
              ),
            ],
            const SizedBox(height: 2),
            if (device.online && device.activeSessions > 0)
              Text(
                '${device.activeSessions} 个活跃会话',
                style: TextStyle(fontSize: 13, color: context.colors.fg2),
              )
            else if (device.isRevoked)
              Text(
                '该设备密钥已吊销，需要重新配对',
                style: TextStyle(fontSize: 13, color: AppColors.red),
              )
            else if (!device.online && lastSeenMins != null)
              Text(
                '最后在线 $lastSeenMins 分钟前',
                style: TextStyle(fontSize: 13, color: context.colors.fg2),
              ),
          ],
        ),
      ),
    );
  }
}

class _AddDeviceRow extends StatelessWidget {
  const _AddDeviceRow({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: context.colors.bg2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: context.colors.tint.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(10),
              ),
              alignment: Alignment.center,
              child: Text(
                '＋',
                style: TextStyle(fontSize: 22, color: context.colors.tint),
              ),
            ),
            const SizedBox(width: 12),
            Text(
              '绑定新设备',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w500,
                color: context.colors.tint,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
