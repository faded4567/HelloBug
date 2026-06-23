import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import '../../models/device_summary.dart';
import '../../theme/index.dart';

class DeviceDetailPage extends StatelessWidget {
  const DeviceDetailPage({super.key, required this.device});
  final DeviceSummary device;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('设备详情', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 48),
          children: [
            // hero card
            Container(
              margin: const EdgeInsets.only(top: 16, bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
              decoration: BoxDecoration(
                color: c.bg2,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(children: [
                Container(
                  width: 64, height: 64,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF1C3A5E), Color(0x220A84FF)],
                    ),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: c.separator),
                  ),
                  alignment: Alignment.center,
                  child: const Text('💻', style: TextStyle(fontSize: 34)),
                ),
                const SizedBox(height: 10),
                Text(device.machineName,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: c.fg)),
                const SizedBox(height: 4),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Container(
                    width: 8, height: 8,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: device.online ? AppColors.green : c.fg3,
                      boxShadow: device.online ? [
                        BoxShadow(color: AppColors.green.withValues(alpha: .25), blurRadius: 4, spreadRadius: 2),
                      ] : null,
                    ),
                  ),
                  const SizedBox(width: 5),
                  Text(device.online ? '在线' : '离线',
                    style: TextStyle(fontSize: 13, color: c.fg2)),
                  if (device.os.isNotEmpty) ...[
                    const Text('  ·  ', style: TextStyle(color: Color(0x40FFFFFF))),
                    Text(device.os, style: TextStyle(fontSize: 13, color: c.fg2)),
                  ],
                ]),
                const SizedBox(height: 4),
                Text('配对于 2026-06-01 · 上次在线 刚刚',
                  style: TextStyle(fontSize: 13, color: c.fg2)),
              ]),
            ),

            // stats row
            Row(children: [
              _StatCard('${device.activeSessions}', '活跃会话', c.tint, c),
              const SizedBox(width: 8),
              _StatCard('3', '工作区', c.fg, c),
              const SizedBox(width: 8),
              _StatCard('14', '历史会话', c.fg, c),
            ]),
            const SizedBox(height: 8),

            // system info
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('系统信息', style: TextStyle(color: c.fg2)),
              children: [
                _InfoRow('🖥', '处理器', 'Apple M3 Max', c),
                _InfoRow('🧠', '内存', '36 GB', c),
                _InfoRow('💾', '磁盘可用', '428 GB', c),
                _InfoRow('🌐', '连接延迟', '18 ms',  c, valueColor: AppColors.green),
              ],
            ),

            // workspaces
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('工作区', style: TextStyle(color: c.fg2)),
              children: [
                _WsRow('HelloBug', 'main', '3 文件已修改', true, c.tintBg, c),
                _WsRow('analytics-svc', 'feat/metrics', '清洁', true,
                  const Color(0xFF5E5CE6).withValues(alpha: .10), c),
                _WsRow('dotfiles', 'main', '', false, c.bg3, c),
              ],
            ),

            // key management
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('设备密钥', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('🔑', AppColors.green.withValues(alpha: .12)),
                  title: const Text('Ed25519 指纹'),
                  subtitle: const Text('SHA256:xK9mP3vQ…J0dL5fN',
                    style: TextStyle(fontFamily: 'Menlo', fontSize: 11)),
                  trailing: CupertinoButton(
                    padding: EdgeInsets.zero,
                    onPressed: () => Clipboard.setData(const ClipboardData(
                      text: 'SHA256:xK9mP3vQ7nR2wZ8bH4cY1tE6aJ0dL5fN')),
                    child: Text('复制', style: TextStyle(fontSize: 13, color: c.tint)),
                  ),
                ),
                CupertinoListTile(
                  leading: _Ico('🔄', AppColors.orange.withValues(alpha: .12)),
                  title: const Text('轮换设备密钥'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
              ],
            ),

            // danger
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('危险操作', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('🔓', AppColors.red.withValues(alpha: .12)),
                  title: const Text('解绑此设备',
                    style: TextStyle(color: AppColors.red)),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => _confirm(context, '解绑此设备', '确认后该设备将无法连接。'),
                ),
                CupertinoListTile(
                  leading: _Ico('🚫', AppColors.red.withValues(alpha: .12)),
                  title: const Text('吊销设备密钥',
                    style: TextStyle(color: AppColors.red)),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => _confirm(context, '吊销设备密钥', '吊销后该设备立即断连，需重新配对。'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _confirm(BuildContext ctx, String title, String message) {
    showCupertinoDialog<void>(
      context: ctx,
      builder: (_) => CupertinoAlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          CupertinoDialogAction(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('取消'),
          ),
          CupertinoDialogAction(
            isDestructiveAction: true,
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('确认'),
          ),
        ],
      ),
    );
  }
}

Widget _StatCard(String value, String label, Color valueColor, ThemeColors c) =>
  Expanded(child: Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
    child: Column(children: [
      Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: valueColor)),
      const SizedBox(height: 2),
      Text(label, style: TextStyle(fontSize: 12, color: c.fg2)),
    ]),
  ));

CupertinoListTile _InfoRow(String icon, String label, String value,
    ThemeColors c, {Color? valueColor}) =>
  CupertinoListTile(
    leading: _Ico(icon, c.bg3),
    title: Text(label),
    additionalInfo: Text(value,
      style: TextStyle(color: valueColor ?? c.fg2, fontSize: 14)),
  );

class _WsRow extends StatelessWidget {
  const _WsRow(this.name, this.branch, this.note, this.active, this.iconBg, this.c);
  final String name, branch, note;
  final bool active;
  final Color iconBg;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) => CupertinoListTile(
    leading: _Ico('📂', iconBg),
    title: Text(name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
    subtitle: Row(children: [
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: const Color(0xFF5E5CE6).withValues(alpha: .15),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(branch,
          style: const TextStyle(fontFamily: 'Menlo', fontSize: 11, color: Color(0xFFBF5AF2))),
      ),
      if (note.isNotEmpty) ...[
        const SizedBox(width: 6),
        Text(note, style: TextStyle(fontSize: 12, color: c.fg3)),
      ],
    ]),
    trailing: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: active ? AppColors.green.withValues(alpha: .15) : c.bg3,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(active ? '运行中' : '空闲',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: active ? AppColors.green : c.fg2,
        )),
    ),
  );
}

Widget _Ico(String emoji, Color bg) => Container(
  width: 30, height: 30,
  decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(7)),
  alignment: Alignment.center,
  child: Text(emoji, style: const TextStyle(fontSize: 16)),
);
