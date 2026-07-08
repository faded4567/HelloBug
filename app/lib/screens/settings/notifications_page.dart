import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../state/settings_provider.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';

class NotificationsPage extends ConsumerWidget {
  const NotificationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final settings = ref.watch(settingsProvider);
    final pushToken = ref.watch(pushTokenProvider);

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('通知与推送', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: pushToken != null
                      ? AppColors.green.withValues(alpha: .12)
                      : AppColors.orange.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Text(
                      pushToken != null ? '🔔' : '⚠️',
                      style: const TextStyle(fontSize: 20),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            pushToken != null ? 'Push 已注册' : 'Push 未注册',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: pushToken != null
                                  ? AppColors.green
                                  : AppColors.orange,
                            ),
                          ),
                          Text(
                            pushToken != null
                                ? '设备 token 已上报至中继服务器'
                                : '需要联网完成配对后才能注册',
                            style: TextStyle(fontSize: 12, color: c.fg3),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            CupertinoListSection.insetGrouped(
              header: Text('推送事件', style: TextStyle(color: c.fg2)),
              children: [
                _Toggle(
                  label: 'Agent 任务完成',
                  value: settings.agentDone,
                  onChanged: (v) => ref.read(settingsProvider.notifier).update((s) => s.copyWith(agentDone: v)),
                  c: c,
                ),
                _Toggle(
                  label: '危险操作等待审批',
                  value: settings.dangerWait,
                  onChanged: (v) => ref.read(settingsProvider.notifier).update((s) => s.copyWith(dangerWait: v)),
                  c: c,
                ),
                _Toggle(
                  label: 'Agent 运行错误',
                  value: settings.agentError,
                  onChanged: (v) => ref.read(settingsProvider.notifier).update((s) => s.copyWith(agentError: v)),
                  c: c,
                ),
                _Toggle(
                  label: '等待用户输入',
                  value: settings.agentInput,
                  onChanged: (v) => ref.read(settingsProvider.notifier).update((s) => s.copyWith(agentInput: v)),
                  c: c,
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: Text('免打扰', style: TextStyle(color: c.fg2)),
              children: [
                _Toggle(
                  label: '免打扰模式',
                  value: settings.dnd,
                  onChanged: (v) => ref.read(settingsProvider.notifier).update((s) => s.copyWith(dnd: v)),
                  c: c,
                ),
                CupertinoListTile(
                  title: const Text('免打扰时段'),
                  additionalInfo: const Text('22:00 - 08:00'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({required this.label, required this.value, required this.onChanged, required this.c});
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return CupertinoListTile(
      title: Text(label),
      trailing: CupertinoSwitch(
        value: value,
        onChanged: onChanged,
        activeTrackColor: c.tint,
      ),
    );
  }
}
