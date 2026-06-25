import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../state/workspace_history_provider.dart';
import '../../state/sessions_provider.dart';
import '../../theme/index.dart';
import '../new_session/new_session_flow.dart';
import 'session_tile.dart';

class SessionsPage extends ConsumerWidget {
  const SessionsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions = ref.watch(sessionsProvider);
    final workspaceHistory = ref.watch(workspaceHistoryProvider).valueOrNull;
    final c = context.colors;
    final initialWorkspacePath =
        workspaceHistory?.currentPath ??
        (workspaceHistory?.recents.isNotEmpty ?? false
            ? workspaceHistory!.recents.first
            : null);

    void openNewSession() {
      context.push(
        '/new-session',
        extra:
            initialWorkspacePath == null
                ? null
                : NewSessionFlowArgs(workspacePath: initialWorkspacePath),
      );
    }

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('会话', style: TextStyle(color: c.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: openNewSession,
          child: Icon(CupertinoIcons.add, color: c.tint),
        ),
      ),
      child: SafeArea(
        child:
            sessions.isEmpty
                ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text('💬', style: const TextStyle(fontSize: 48)),
                      const SizedBox(height: 16),
                      Text(
                        '还没有会话',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          color: c.fg,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '连接到设备后新建一个会话',
                        style: TextStyle(fontSize: 14, color: c.fg2),
                      ),
                      const SizedBox(height: 24),
                      CupertinoButton.filled(
                        onPressed: openNewSession,
                        child: const Text('新建会话'),
                      ),
                    ],
                  ),
                )
                : ListView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  children: [
                    _SectionHeader(label: '会话'),
                    ...sessions.map(
                      (s) => SessionTile(
                        session: s,
                        onTap: () {
                          unawaited(
                            ref
                                .read(workspaceHistoryProvider.notifier)
                                .visit(s.workspacePath),
                          );
                          ref
                              .read(sessionsProvider.notifier)
                              .markRead(s.sessionId);
                          context.push(
                            s.agentType == 'shell'
                                ? '/terminal/${s.sessionId}'
                                : '/session/${s.sessionId}',
                            extra: s,
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 20),
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
      padding: const EdgeInsets.only(top: 12, bottom: 8, left: 4),
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
