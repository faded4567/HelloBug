import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';

import '../../theme/index.dart';

// Stub model — will be replaced by Riverpod provider in M2
class _Device {
  const _Device({
    required this.id,
    required this.name,
    required this.os,
    required this.isOnline,
    this.activeSessions = 0,
    this.workspaces = 0,
    this.lastSeenMinutes,
  });
  final String id;
  final String name;
  final String os;
  final bool isOnline;
  final int activeSessions;
  final int workspaces;
  final int? lastSeenMinutes;
}

const _stubDevices = [
  _Device(id: 'd1', name: 'MacBook Pro M3', os: 'macOS 14.5', isOnline: true, activeSessions: 2, workspaces: 3),
  _Device(id: 'd2', name: '办公室主机', os: 'Ubuntu 22.04', isOnline: false, lastSeenMinutes: 12),
];

class DevicesPage extends StatelessWidget {
  const DevicesPage({super.key});

  @override
  Widget build(BuildContext context) {
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
            ..._stubDevices.map((d) => _DeviceCard(device: d)),
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
                TextSpan(children: [
                  const TextSpan(text: '💡 '),
                  TextSpan(text: '向左滑动', style: TextStyle(fontWeight: FontWeight.w700, color: context.colors.fg)),
                  TextSpan(text: '卡片可解绑设备并吊销其访问权限',
                    style: TextStyle(color: context.colors.fg2)),
                ]),
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
      child: Text(label.toUpperCase(),
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: context.colors.fg2, letterSpacing: .5)),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({required this.device});
  final _Device device;

  @override
  Widget build(BuildContext context) {
    return Container(
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
              Text(device.isOnline ? '💻' : '🖥', style: const TextStyle(fontSize: 20)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(device.name,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: context.colors.fg)),
              ),
              Container(
                width: 8, height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: device.isOnline ? const Color(0xFF34C759) : context.colors.fg3,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                device.isOnline ? '在线' : '离线',
                style: TextStyle(
                  fontSize: 13,
                  color: device.isOnline ? const Color(0xFF34C759) : context.colors.fg3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(device.os, style: TextStyle(fontSize: 13, color: context.colors.fg2)),
          const SizedBox(height: 2),
          if (device.isOnline)
            Text(
              '${device.activeSessions} 个活跃会话 · ${device.workspaces} 个工作区',
              style: TextStyle(fontSize: 13, color: context.colors.fg2),
            )
          else if (device.lastSeenMinutes != null)
            Text(
              '最后在线 ${device.lastSeenMinutes} 分钟前',
              style: TextStyle(fontSize: 13, color: context.colors.fg2),
            ),
        ],
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
              width: 40, height: 40,
              decoration: BoxDecoration(
                color: context.colors.tint.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(10),
              ),
              alignment: Alignment.center,
              child: Text('＋', style: TextStyle(fontSize: 22, color: context.colors.tint)),
            ),
            const SizedBox(width: 12),
            Text('绑定新设备',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: context.colors.tint)),
          ],
        ),
      ),
    );
  }
}
