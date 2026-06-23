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
  });
  final SessionSummary session;
  final VoidCallback onCancel;
  final VoidCallback onWorkspaceSwitch; // sheet caller handles path via session context

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final parts = session.workspacePath.split('/');
    final wsName = parts.lastWhere((p) => p.isNotEmpty, orElse: () => session.workspacePath);
    final agentLabel = switch (session.agentType) {
      'claude_code' => 'Claude Code',
      'codex' => 'Codex',
      _ => 'Shell',
    };

    return CupertinoNavigationBar(
      backgroundColor: c.bg,
      border: null,
      leading: CupertinoButton(
        padding: EdgeInsets.zero,
        onPressed: onCancel,
        child: Icon(CupertinoIcons.xmark, size: 18, color: c.fg2),
      ),
      middle: GestureDetector(
        onTap: () => SessionInfoSheet.show(context, session),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(wsName, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.fg)),
          Text(agentLabel, style: TextStyle(fontSize: 12, color: c.fg2)),
        ]),
      ),
      trailing: CupertinoButton(
        padding: EdgeInsets.zero,
        onPressed: onCancel,
        child: Text('取消', style: TextStyle(fontSize: 14, color: AppColors.red)),
      ),
    );
  }
}
