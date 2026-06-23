import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import '../../theme/index.dart';

class SettingsHomePage extends StatelessWidget {
  const SettingsHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('设置', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          children: [
            CupertinoListSection.insetGrouped(
              header: Text('设备与配对', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('💻', c),
                  title: const Text('已配对设备'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/devices'),
                ),
                CupertinoListTile(
                  leading: _Icon('📱', c),
                  title: const Text('绑定新设备'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/pairing'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('外观', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('🎨', c),
                  title: const Text('外观'),
                  additionalInfo: const Text('字号 · Diff 视图'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/appearance'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('代理与安全', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('🔒', c),
                  title: const Text('安全与隐私'),
                  additionalInfo: const Text('生物认证 · 屏幕锁'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/security'),
                ),
                CupertinoListTile(
                  leading: _Icon('🛡', c),
                  title: const Text('危险规则'),
                  additionalInfo: const Text('黑白名单'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/danger-rules'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('通知与模板', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('🔔', c),
                  title: const Text('通知'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/notifications'),
                ),
                CupertinoListTile(
                  leading: _Icon('📋', c),
                  title: const Text('快捷模板'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/templates'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('连接', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('🌐', c),
                  title: const Text('中继服务器'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/relay'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('会话', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('📋', c),
                  title: const Text('历史记录'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/history'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('开发者', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('🔧', c),
                  title: const Text('Diff 渲染 Spike F3'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/diff-spike'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              children: [
                CupertinoListTile(
                  leading: _Icon('ℹ️', c),
                  title: const Text('关于'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/about'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Icon extends StatelessWidget {
  const _Icon(this.emoji, this.c);
  final String emoji;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 30, height: 30,
      decoration: BoxDecoration(color: c.bg3, borderRadius: BorderRadius.circular(7)),
      alignment: Alignment.center,
      child: Text(emoji, style: const TextStyle(fontSize: 16)),
    );
  }
}

