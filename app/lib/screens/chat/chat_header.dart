import 'package:flutter/cupertino.dart';
import '../../models/session_summary.dart';
import '../../theme/index.dart';
import '../sessions/session_info_sheet.dart';

class ChatHeader extends StatelessWidget {
  const ChatHeader({
    super.key,
    required this.session,
    required this.onCancel,
    required this.onWorkspaceSwitch,
    this.totalInputTokens,
    this.totalOutputTokens,
  });
  final SessionSummary session;
  final VoidCallback onCancel;
  final VoidCallback onWorkspaceSwitch;
  final int? totalInputTokens;
  final int? totalOutputTokens;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final agentLabel = switch (session.agentType) {
      'claude_code' => 'Claude Code',
      'codex' => 'Codex',
      _ => 'Shell',
    };
    final statusText = switch (session.status) {
      SessionStatus.running => '运行中',
      SessionStatus.replaying => '回放中',
      SessionStatus.offline => '已失效',
      SessionStatus.done => '已完成',
    };

    return Container(
      decoration: BoxDecoration(
        color: c.bg,
        border: Border(bottom: BorderSide(color: c.separator)),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: 52,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    CupertinoButton(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(32, 32),
                      onPressed: onCancel,
                      child: Icon(
                        CupertinoIcons.chevron_left,
                        size: 18,
                        color: c.fg2,
                      ),
                    ),
                    Expanded(
                      child: Center(
                        child: Text(
                          'HelloBug · $agentLabel',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: c.fg,
                          ),
                        ),
                      ),
                    ),
                    CupertinoButton(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(32, 32),
                      onPressed: () => SessionInfoSheet.show(context, session),
                      child: Icon(
                        CupertinoIcons.ellipsis,
                        size: 18,
                        color: c.fg2,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: onWorkspaceSwitch,
                    child: Container(
                      constraints: const BoxConstraints(maxWidth: 180),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: c.bg3,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            '⌂',
                            style: TextStyle(fontSize: 10, color: c.fg3),
                          ),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              session.workspacePath,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 11, color: c.fg2),
                            ),
                          ),
                          const SizedBox(width: 2),
                          Text(
                            '▾',
                            style: TextStyle(fontSize: 9, color: c.fg3),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      statusText,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11, color: c.fg3),
                    ),
                  ),
                  if (totalInputTokens != null || totalOutputTokens != null)
                    Text(
                      '📊 ${totalInputTokens ?? '?'}→${totalOutputTokens ?? '?'}',
                      style: TextStyle(fontSize: 11, color: c.fg3),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
