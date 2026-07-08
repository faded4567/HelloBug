import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../state/chat_provider.dart';
import '../../state/devices_provider.dart';
import '../../state/drafts_provider.dart';
import '../../state/sessions_provider.dart';
import '../../state/settings_provider.dart';
import '../../state/templates_provider.dart';
import '../../state/workspaces_provider.dart';
import '../../theme/index.dart';
import '../../transport/app_runtime_store.dart';
import '../../transport/ws_provider.dart';

class SettingsHomePage extends ConsumerWidget {
  const SettingsHomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final devices = ref.watch(devicesProvider);
    final templates = ref.watch(templatesProvider);
    final settings = ref.watch(settingsProvider);
    final themeMode = ref.watch(themeModeProvider);
    final hasRelay = ref.watch(wsClientProvider) != null;
    final pairedCount = devices.length;
    final onlineCount = devices.values.where((device) => device.online).length;
    final activeDevice = devices.values.firstOrNull;
    final profileTitle =
        activeDevice?.machineName.isNotEmpty == true
            ? activeDevice!.machineName
            : 'HelloBug';
    final profileSubtitle =
        pairedCount > 0
            ? '$pairedCount 台设备已配对 · ${hasRelay ? 'Relay 已连接' : 'Relay 未连接'}'
            : '还没有完成设备配对';
    final appearanceLabel = switch (themeMode) {
      AppThemeMode.dark => '深色',
      AppThemeMode.light => '浅色',
      AppThemeMode.system => '跟随系统',
    };

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('设置', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            _ProfileCard(
              title: profileTitle,
              subtitle: profileSubtitle,
              detail: onlineCount > 0 ? '$onlineCount 台设备当前在线' : '打开设备页可查看详细状态',
            ),
            CupertinoListSection.insetGrouped(
              header: Text('设备与配对', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('💻', c, background: c.tintBg),
                  title: const Text('已配对设备'),
                  additionalInfo: Text(
                    pairedCount > 0 ? '$pairedCount 台' : '未配对',
                    style: TextStyle(
                      color: pairedCount > 0 ? c.fg2 : AppColors.orange,
                    ),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/devices'),
                ),
                CupertinoListTile(
                  leading: _Icon(
                    '📱',
                    c,
                    background: AppColors.green.withValues(alpha: .12),
                  ),
                  title: const Text('绑定新设备'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/pairing'),
                ),
                CupertinoListTile(
                  leading: _Icon(
                    '🔗',
                    c,
                    background: AppColors.orange.withValues(alpha: .12),
                  ),
                  title: const Text('服务器连接'),
                  additionalInfo: _ConnectionStatus(connected: hasRelay),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/relay'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('安全与隐私', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon(
                    '🔐',
                    c,
                    background: AppColors.red.withValues(alpha: .12),
                  ),
                  title: const Text('安全与隐私'),
                  additionalInfo: Text('生物认证', style: TextStyle(color: c.fg2)),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/security'),
                ),
                CupertinoListTile(
                  leading: _Icon(
                    '⚠️',
                    c,
                    background: AppColors.orange.withValues(alpha: .12),
                  ),
                  title: const Text('危险操作规则'),
                  additionalInfo: Text(
                    '黑名单 ${settings.dangerRules.length} 条',
                    style: TextStyle(color: c.fg2),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/danger-rules'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('个性化', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon(
                    '🎨',
                    c,
                    background: const Color(0xFF5E5CE6).withValues(alpha: .2),
                  ),
                  title: const Text('外观'),
                  additionalInfo: Text(
                    appearanceLabel,
                    style: TextStyle(color: c.fg2),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/appearance'),
                ),
                CupertinoListTile(
                  leading: _Icon('⚡', c, background: c.tintBg),
                  title: const Text('快捷模板'),
                  additionalInfo: Text(
                    '${templates.length} 个',
                    style: TextStyle(color: c.fg2),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/templates'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('通知', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon(
                    '🔔',
                    c,
                    background: AppColors.green.withValues(alpha: .12),
                  ),
                  title: const Text('通知与推送'),
                  additionalInfo: Text(
                    hasRelay ? '已启用' : '待配置',
                    style: TextStyle(
                      color: hasRelay ? AppColors.green : AppColors.orange,
                    ),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/notifications'),
                ),
                CupertinoListTile(
                  leading: _Icon('🌙', c, background: c.tintBg),
                  title: const Text('免打扰时段'),
                  additionalInfo: Text(
                    '22:00 - 08:00',
                    style: TextStyle(color: c.fg2),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/notifications'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('数据', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon(
                    '📤',
                    c,
                    background: AppColors.orange.withValues(alpha: .12),
                  ),
                  title: const Text('会话历史'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/history'),
                ),
                CupertinoListTile(
                  leading: _Icon(
                    '🗑',
                    c,
                    background: AppColors.red.withValues(alpha: .12),
                  ),
                  title: const Text(
                    '清除本地缓存',
                    style: TextStyle(color: AppColors.red),
                  ),
                  onTap: () => _clearCache(context, ref, c),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('关于', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Icon('ℹ️', c, background: c.bg3),
                  title: const Text('关于 HelloBug'),
                  additionalInfo: Text(
                    'v0.1.0',
                    style: TextStyle(color: c.fg2),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => context.push('/settings/about'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('危险操作', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  title: const Center(
                    child: Text(
                      '重置 App',
                      style: TextStyle(
                        color: AppColors.red,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  onTap: () => _confirmReset(context, ref),
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
  const _Icon(this.emoji, this.c, {this.background});
  final String emoji;
  final ThemeColors c;
  final Color? background;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 30,
      height: 30,
      decoration: BoxDecoration(
        color: background ?? c.bg3,
        borderRadius: BorderRadius.circular(7),
      ),
      alignment: Alignment.center,
      child: Text(emoji, style: const TextStyle(fontSize: 16)),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({
    required this.title,
    required this.subtitle,
    required this.detail,
  });

  final String title;
  final String subtitle;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF0A84FF), Color(0xFF5E5CE6)],
              ),
            ),
            alignment: Alignment.center,
            child: const Text('🐛', style: TextStyle(fontSize: 26)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: c.fg,
                  ),
                ),
                const SizedBox(height: 2),
                Text(subtitle, style: TextStyle(fontSize: 13, color: c.fg2)),
                const SizedBox(height: 4),
                Text(detail, style: TextStyle(fontSize: 12, color: c.fg3)),
              ],
            ),
          ),
          Icon(CupertinoIcons.chevron_forward, size: 16, color: c.fg3),
        ],
      ),
    );
  }
}

class _ConnectionStatus extends StatelessWidget {
  const _ConnectionStatus({required this.connected});

  final bool connected;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final color = connected ? AppColors.green : AppColors.orange;
    return Text(
      connected ? '已连接' : '未连接',
      style: TextStyle(color: connected ? color : c.fg2),
    );
  }
}

void _confirmReset(BuildContext context, WidgetRef ref) {
  showCupertinoDialog<void>(
    context: context,
    builder:
        (dialogContext) => CupertinoAlertDialog(
          title: const Text('重置 App'),
          content: const Text('将清除所有配对数据、会话记录和本地缓存，并返回初始流程。'),
          actions: [
            CupertinoDialogAction(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('取消'),
            ),
            CupertinoDialogAction(
              isDestructiveAction: true,
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                final client = ref.read(wsClientProvider);
                ref.read(wsClientProvider.notifier).state = null;
                client?.dispose();
                ref.read(devicesProvider.notifier).clear();
                ref.read(sessionsProvider.notifier).clear();
                ref.invalidate(chatProvider);
                ref.invalidate(draftsProvider);
                ref.invalidate(workspacesProvider);
                await AppRuntimeStore.clear();
                if (context.mounted) {
                  context.go('/onboarding');
                }
              },
              child: const Text('重置'),
            ),
          ],
        ),
  );
}

void _clearCache(BuildContext context, WidgetRef ref, ThemeColors c) {
  showCupertinoDialog<void>(
    context: context,
    builder:
        (dialogContext) => CupertinoAlertDialog(
          title: const Text('清除本地缓存'),
          content: const Text('将清除会话列表缓存和已加载的消息记录，不影响服务器端数据。'),
          actions: [
            CupertinoDialogAction(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('取消'),
            ),
            CupertinoDialogAction(
              isDestructiveAction: true,
              onPressed: () {
                Navigator.of(dialogContext).pop();
                ref.invalidate(chatProvider);
                ref.read(sessionsProvider.notifier).clear();
                _showMessage(
                  context,
                  title: '已清除',
                  message: '本地缓存已清理',
                );
              },
              child: const Text('清除'),
            ),
          ],
        ),
  );
}

void _showMessage(
  BuildContext context, {
  required String title,
  required String message,
}) {
  showCupertinoDialog<void>(
    context: context,
    builder:
        (dialogContext) => CupertinoAlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            CupertinoDialogAction(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('知道了'),
            ),
          ],
        ),
  );
}
