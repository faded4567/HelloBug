import 'package:flutter/cupertino.dart';
import '../../models/session_summary.dart';
import '../../theme/index.dart';

class SessionTile extends StatelessWidget {
  const SessionTile({super.key, required this.session, required this.onTap});
  final SessionSummary session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final agentIcon = switch (session.agentType) {
      'claude_code' => '🤖',
      'codex' => '⚡',
      _ => '🖥',
    };
    final parts = session.workspacePath.split('/');
    final name = parts.lastWhere((p) => p.isNotEmpty, orElse: () => session.workspacePath);
    final isRunning = session.status == SessionStatus.running;
    final isReplaying = session.status == SessionStatus.replaying;
    final isOffline = session.status == SessionStatus.offline;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          Text(agentIcon, style: const TextStyle(fontSize: 20)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(name,
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.fg),
                  maxLines: 1, overflow: TextOverflow.ellipsis)),
                if (session.unread > 0) _UnreadBadge(count: session.unread),
              ]),
              const SizedBox(height: 2),
              if (session.lastPreview.isNotEmpty)
                Text(session.lastPreview,
                  style: TextStyle(fontSize: 13, color: c.fg2),
                  maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
          const SizedBox(width: 8),
          if (isRunning || isReplaying)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: CupertinoActivityIndicator(
                radius: 7,
                color: isReplaying ? CupertinoColors.activeOrange : c.tint,
              ),
            ),
          if (isOffline)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Icon(
                CupertinoIcons.exclamationmark_circle,
                size: 16,
                color: CupertinoColors.systemOrange,
              ),
            ),
          Icon(CupertinoIcons.chevron_right, size: 14, color: c.fg3),
        ]),
      ),
    );
  }
}

class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: const BoxDecoration(
        color: AppColors.red,
        borderRadius: BorderRadius.all(AppRadius.pill),
      ),
      child: Text(
        count > 99 ? '99+' : count.toString(),
        style: const TextStyle(color: Color(0xFFFFFFFF), fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
