import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/device_summary.dart';
import '../../state/devices_provider.dart';
import '../../theme/index.dart';

class DevicesPage extends ConsumerWidget {
  const DevicesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
    return CupertinoPageScaffold(
      backgroundColor: context.colors.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: context.colors.bg,
        border: null,
        middle: Text('我的设备', style: TextStyle(color: context.colors.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: () {},
          child: Icon(CupertinoIcons.settings, color: context.colors.fg),
        ),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          children: [
            _SectionHeader(label: '已配对'),
            ...devices.map((d) => _DeviceCard(device: d)),
            _SectionHeader(label: '添加'),
            _AddDeviceRow(onTap: () => context.push('/pairing')),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: context.colors.bg2,
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
                        color: context.colors.fg,
                      ),
                    ),
                    TextSpan(
                      text: '卡片可解绑设备并吊销其访问权限',
                      style: TextStyle(color: context.colors.fg2),
                    ),
                  ],
                ),
                style: const TextStyle(fontSize: 13, height: 1.6),
              ),
            ),
          ],
        ),
      ),
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
            ? const Color(0xFF34C759)
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
