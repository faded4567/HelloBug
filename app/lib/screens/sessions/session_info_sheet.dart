import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/session_summary.dart';
import '../../models/inner_message.dart';
import '../../state/devices_provider.dart';
import '../../state/workspace_history_provider.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import '../filetree/file_tree_page.dart';
import '../history/history_page.dart';

class SessionInfoSheet extends ConsumerWidget {
  const SessionInfoSheet({super.key, required this.session});
  final SessionSummary session;

  static Future<void> show(BuildContext context, SessionSummary session) =>
      showCupertinoModalPopup<void>(
        context: context,
        builder: (_) => SessionInfoSheet(session: session),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final running = session.status == SessionStatus.running;
    final replaying = session.status == SessionStatus.replaying;
    final offline = session.status == SessionStatus.offline;
    final wsName = session.workspacePath
        .split('/')
        .lastWhere((p) => p.isNotEmpty, orElse: () => session.workspacePath);
    final devices = ref.watch(devicesProvider);
    final device = devices[session.deviceId];
    final agentLabel = switch (session.agentType) {
      'claude_code' => 'Claude Code',
      'codex' => 'Codex',
      _ => 'Shell',
    };
    final statusText =
        running
            ? '运行中'
            : replaying
            ? '回放中'
            : offline
            ? '已失效'
            : '已完成';
    final statusColor =
        running
            ? AppColors.green
            : replaying
            ? CupertinoColors.activeOrange
            : offline
            ? AppColors.red
            : c.fg2;
    final statusBg =
        running
            ? AppColors.green.withValues(alpha: .15)
            : replaying
            ? CupertinoColors.activeOrange.withValues(alpha: .15)
            : offline
            ? AppColors.red.withValues(alpha: .12)
            : c.bg3;

    return Container(
      padding: EdgeInsets.fromLTRB(
        0,
        0,
        0,
        MediaQuery.of(context).padding.bottom + 8,
      ),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // handle
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: c.bg4,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
          ),

          // header row
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '会话信息',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      color: c.fg,
                    ),
                  ),
                ),
                CupertinoButton(
                  padding: EdgeInsets.zero,
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(
                    '完成',
                    style: TextStyle(fontSize: 15, color: c.tint),
                  ),
                ),
              ],
            ),
          ),

          // status row
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
            child: Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: statusColor,
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  wsName,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: c.fg,
                  ),
                ),
                const SizedBox(width: 8),
                _Pill(statusText, statusColor, statusBg),
                const Spacer(),
                Text(
                  _formatDuration(session.startedAt),
                  style: TextStyle(fontSize: 12, color: c.fg3),
                ),
              ],
            ),
          ),

          // stats card
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Container(
              decoration: BoxDecoration(
                color: c.bg2,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  _statRow('Agent', agentLabel, c, mono: false),
                  _statRow(
                    '设备',
                    (device?.machineName.isNotEmpty ?? false)
                        ? device!.machineName
                        : session.deviceId,
                    c,
                    mono: device == null,
                  ),
                  _statRow('会话 ID', session.sessionId, c),
                  _statRow('工作区', session.workspacePath, c),
                  _statRow(
                    '开始时间',
                    _formatStartedAt(session.startedAt),
                    c,
                    last: true,
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child:
                running || replaying
                    ? Row(
                      children: [
                        Expanded(
                          child: CupertinoButton(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            color: c.bg2,
                            borderRadius: BorderRadius.circular(10),
                            onPressed: () => _openFileTree(context, ref),
                            child: Text(
                              '文件树',
                              style: TextStyle(fontSize: 13, color: c.fg),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: CupertinoButton(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            color: c.bg2,
                            borderRadius: BorderRadius.circular(10),
                            onPressed:
                                () => Clipboard.setData(
                                  ClipboardData(text: session.sessionId),
                                ),
                            child: Text(
                              '复制 ID',
                              style: TextStyle(fontSize: 13, color: c.fg),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: CupertinoButton(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            color: AppColors.red.withValues(alpha: .15),
                            borderRadius: BorderRadius.circular(10),
                            onPressed: () {
                              unawaited(
                                ref
                                    .read(wsClientProvider)
                                    ?.send(
                                      InnerMessage.create('session.cancel', {
                                        'session_id': session.sessionId,
                                      }),
                                    ),
                              );
                              Navigator.of(context).pop();
                            },
                            child: Text(
                              '终止',
                              style: TextStyle(
                                fontSize: 13,
                                color: AppColors.red,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ],
                    )
                    : Row(
                      children: [
                        Expanded(
                          child: CupertinoButton(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            color: c.bg2,
                            borderRadius: BorderRadius.circular(10),
                            onPressed:
                                () => Clipboard.setData(
                                  ClipboardData(text: session.sessionId),
                                ),
                            child: Text(
                              '复制会话 ID',
                              style: TextStyle(fontSize: 13, color: c.fg),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: CupertinoButton(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            color: c.tintBg,
                            borderRadius: BorderRadius.circular(10),
                            onPressed: () => _openHistoryDetail(context),
                            child: Text(
                              '查看历史',
                              style: TextStyle(
                                fontSize: 13,
                                color: c.tint,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  void _openHistoryDetail(BuildContext context) {
    final navigator = Navigator.of(context, rootNavigator: true);
    navigator.pop();
    Future<void>.delayed(Duration.zero, () {
      navigator.push(
        CupertinoPageRoute(
          builder:
              (_) => HistoryDetailPage(
                sessionId: session.sessionId,
                workspacePath: session.workspacePath,
              ),
        ),
      );
    });
  }

  void _openFileTree(BuildContext context, WidgetRef ref) {
    final navigator = Navigator.of(context, rootNavigator: true);
    unawaited(
      ref.read(workspaceHistoryProvider.notifier).visit(session.workspacePath),
    );
    navigator.pop();
    Future<void>.delayed(Duration.zero, () {
      navigator.push(
        CupertinoPageRoute(
          builder:
              (_) => FileTreePage(
                sessionId: session.sessionId,
                workspacePath: session.workspacePath,
              ),
        ),
      );
    });
  }
}

Widget _statRow(
  String label,
  String value,
  ThemeColors c, {
  bool mono = true,
  bool last = false,
}) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
  decoration: BoxDecoration(
    border: last ? null : Border(bottom: BorderSide(color: c.separator)),
  ),
  child: Row(
    children: [
      Expanded(
        child: Text(label, style: TextStyle(fontSize: 14, color: c.fg2)),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Text(
          value,
          textAlign: TextAlign.right,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 14,
            color: c.fg,
            fontFamily: mono ? 'Menlo' : null,
          ),
        ),
      ),
    ],
  ),
);

String _formatStartedAt(DateTime? value) {
  if (value == null) {
    return '未知';
  }
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '$month/$day $hour:$minute';
}

String _formatDuration(DateTime? startedAt) {
  if (startedAt == null) {
    return '时长未知';
  }
  final elapsed = DateTime.now().difference(startedAt);
  if (elapsed.inHours > 0) {
    return '${elapsed.inHours} 小时';
  }
  if (elapsed.inMinutes > 0) {
    return '${elapsed.inMinutes} 分钟';
  }
  return '${elapsed.inSeconds.clamp(0, 59)} 秒';
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, this.color, this.bg);
  final String text;
  final Color color, bg;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      text,
      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color),
    ),
  );
}
