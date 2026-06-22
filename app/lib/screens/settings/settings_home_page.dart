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
              header: Text('代理与安全', style: TextStyle(color: c.fg2)),
              children: [
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

