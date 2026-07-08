import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../models/session_summary.dart';
import '../state/devices_provider.dart';
import '../state/sessions_provider.dart';
import '../state/workspace_history_provider.dart';
import '../theme/index.dart';
import '../widgets/workspace_switch/workspace_switch_sheet.dart';
import 'new_session/new_session_flow.dart';
import 'sessions/session_tile.dart';

/// Workspace home page — wireframe 43.
///
/// Replaces the old SessionsPage as the first tab.
/// Shows sessions + history via segmented control.
class WorkspaceHomePage extends ConsumerStatefulWidget {
  const WorkspaceHomePage({super.key});

  @override
  ConsumerState<WorkspaceHomePage> createState() => _WorkspaceHomePageState();
}

class _WorkspaceHomePageState extends ConsumerState<WorkspaceHomePage> {
  int _segment = 0; // 0=会话, 1=历史

  @override
  Widget build(BuildContext context) {
    final sessions = ref.watch(sessionsProvider);
    final workspaceHistory = ref.watch(workspaceHistoryProvider).valueOrNull;
    final devices = ref.watch(devicesProvider);
    final c = context.colors;

    final currentPath = workspaceHistory?.currentPath;
    final workspaceName =
        currentPath?.split('/').lastOrNull ??
        (currentPath?.isNotEmpty == true ? currentPath : null);
    final activeDaemon = devices.values.where((d) => d.online).firstOrNull;
    final displayName = workspaceName ?? 'HelloBug';
    final deviceName = activeDaemon?.machineName;

    void openNewSession() {
      context.push(
        '/new-session',
        extra:
            currentPath != null
                ? NewSessionFlowArgs(workspacePath: currentPath)
                : null,
      );
    }

    void openWorkspaceSwitch() {
      showCupertinoModalPopup<void>(
        context: context,
        builder:
            (_) => WorkspaceSwitchSheet(
              currentPath: currentPath ?? '',
              onSwitch: (newPath) {
                context.push(
                  '/new-session',
                  extra: NewSessionFlowArgs(
                    workspacePath: newPath,
                    preferredDeviceId: activeDaemon?.deviceId,
                  ),
                );
              },
            ),
      );
    }

    void openHistory() {
      context.push('/history');
    }

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: SafeArea(
        child: Column(
          children: [
            // ── Nav bar ──
            _WorkspaceNav(
              displayName: displayName,
              deviceName: deviceName,
              onWorkspaceSwitch: openWorkspaceSwitch,
              onSettings: () => context.push('/settings'),
            ),

            // ── Agent chips ──
            _AgentChips(),

            // ── Segmented control ──
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: _SegmentedControl(
                items: const ['会话', '历史'],
                selected: _segment,
                onChanged: (i) => setState(() => _segment = i),
              ),
            ),

            // ── Content ──
            Expanded(
              child:
                  _segment == 0
                      ? _buildSessions(sessions, openNewSession, openHistory)
                      : _buildHistoryHint(openHistory),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSessions(
    List<SessionSummary> sessions,
    VoidCallback openNewSession,
    VoidCallback openHistory,
  ) {
    final c = context.colors;

    if (sessions.isEmpty) {
      // 43-C: empty state
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('💬', style: TextStyle(fontSize: 52, color: c.fg3.withValues(alpha: .25))),
              const SizedBox(height: 12),
              Text(
                '还没有会话',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  color: c.fg,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '点击 ＋ 开始新会话',
                style: TextStyle(fontSize: 14, color: c.fg3),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 4),
              CupertinoButton.filled(
                onPressed: openNewSession,
                child: const Text('新建会话'),
              ),
            ],
          ),
        ),
      );
    }

    return Stack(
      clipBehavior: Clip.none,
      children: [
        ListView.builder(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          itemCount: sessions.length + 1, // +1 for FAB spacer
          itemBuilder: (ctx, i) {
            if (i == sessions.length) return const SizedBox(height: 80);
            final s = sessions[i];
            return Dismissible(
              key: Key('session-${s.sessionId}'),
              direction: DismissDirection.endToStart,
              background: Container(
                alignment: Alignment.centerRight,
                padding: const EdgeInsets.only(right: 20),
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  color: AppColors.red,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text('删除', style: TextStyle(color: CupertinoColors.white, fontSize: 15, fontWeight: FontWeight.w600)),
              ),
              confirmDismiss: (_) async {
                final result = await showCupertinoDialog<bool>(
                  context: context,
                  builder: (dialogCtx) => CupertinoAlertDialog(
                    title: const Text('删除会话'),
                    content: const Text('删除后可从历史记录中继续查看'),
                    actions: [
                      CupertinoDialogAction(child: const Text('取消'), onPressed: () => Navigator.of(dialogCtx).pop(false)),
                      CupertinoDialogAction(isDestructiveAction: true, child: const Text('删除'), onPressed: () => Navigator.of(dialogCtx).pop(true)),
                    ],
                  ),
                );
                return result ?? false;
              },
              onDismissed: (_) {
                _removeSession(ref, s.sessionId);
              },
              child: SessionTile(
                session: s,
                onTap: () {
                  unawaited(ref.read(workspaceHistoryProvider.notifier).visit(s.workspacePath));
                  ref.read(sessionsProvider.notifier).markRead(s.sessionId);
                  context.push(
                    s.agentType == 'shell' ? '/terminal/${s.sessionId}' : '/session/${s.sessionId}',
                    extra: s,
                  );
                },
              ),
            );
          },
        ),
        Positioned(
          bottom: 12,
          right: 16,
          child: SizedBox(
            width: 50,
            height: 50,
            child: GestureDetector(
              onTap: openNewSession,
              child: Container(
                decoration: BoxDecoration(
                  color: c.tint,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: c.tint.withValues(alpha: .4),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                alignment: Alignment.center,
                child: const Text(
                  '＋',
                  style: TextStyle(fontSize: 24, color: CupertinoColors.white),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildHistoryHint(VoidCallback openHistory) {
    final c = context.colors;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('📋', style: TextStyle(fontSize: 52, color: c.fg3.withValues(alpha: .25))),
            const SizedBox(height: 12),
            Text(
              '查看历史记录',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: c.fg,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '浏览已完成会话的完整记录',
              style: TextStyle(fontSize: 14, color: c.fg3),
            ),
            const SizedBox(height: 8),
            CupertinoButton.filled(
              onPressed: openHistory,
              child: const Text('打开历史'),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Nav bar ────────────────────────────────────────────────────────────────

class _WorkspaceNav extends StatelessWidget {
  const _WorkspaceNav({
    required this.displayName,
    required this.deviceName,
    required this.onWorkspaceSwitch,
    required this.onSettings,
  });

  final String displayName;
  final String? deviceName;
  final VoidCallback onWorkspaceSwitch;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          GestureDetector(
            onTap: onWorkspaceSwitch,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  displayName,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: c.fg,
                  ),
                ),
                const SizedBox(width: 4),
                Icon(
                  CupertinoIcons.chevron_down,
                  size: 10,
                  color: c.fg3,
                ),
                if (deviceName != null) ...[
                  const SizedBox(width: 2),
                  Text(
                    deviceName!,
                    style: TextStyle(fontSize: 12, color: c.fg3),
                  ),
                ],
              ],
            ),
          ),
          const Spacer(),
          GestureDetector(
            onTap: onSettings,
            child: Text('⚙', style: TextStyle(fontSize: 16, color: c.tint)),
          ),
        ],
      ),
    );
  }
}

// ─── Agent chips ─────────────────────────────────────────────────────────────

class _AgentChips extends StatelessWidget {
  const _AgentChips();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          _Chip(
            label: 'claude-code',
            active: true,
            color: AppColors.green,
          ),
          const SizedBox(width: 6),
          _Chip(
            label: 'codex',
            active: true,
            color: c.tint,
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.active, required this.color});
  final String label;
  final bool active;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: active ? color.withValues(alpha: .15) : c.bg3,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: active ? color : c.fg3,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Segmented control ───────────────────────────────────────────────────────

class _SegmentedControl extends StatelessWidget {
  const _SegmentedControl({
    required this.items,
    required this.selected,
    required this.onChanged,
  });

  final List<String> items;
  final int selected;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: c.bg3,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: List.generate(items.length, (i) {
          final active = i == selected;
          return Expanded(
            child: GestureDetector(
              onTap: () => onChanged(i),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 5),
                decoration: BoxDecoration(
                  color: active ? c.bg2 : null,
                  borderRadius: BorderRadius.circular(6),
                  boxShadow:
                      active
                          ? [
                            BoxShadow(
                              color: const Color(0x33000000),
                              blurRadius: 3,
                              offset: const Offset(0, 1),
                            ),
                          ]
                          : null,
                ),
                alignment: Alignment.center,
                child: Text(
                  items[i],
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: active ? FontWeight.w500 : FontWeight.w400,
                    color: active ? c.fg : c.fg2,
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}

void _removeSession(WidgetRef ref, String sessionId) {
  ref.read(sessionsProvider.notifier).markOffline(sessionId);
}
