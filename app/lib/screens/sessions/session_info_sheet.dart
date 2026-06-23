import 'package:flutter/cupertino.dart';
import '../../models/session_summary.dart';
import '../../theme/index.dart';

class SessionInfoSheet extends StatelessWidget {
  const SessionInfoSheet({super.key, required this.session});
  final SessionSummary session;

  static Future<void> show(BuildContext context, SessionSummary session) =>
      showCupertinoModalPopup<void>(
        context: context,
        builder: (_) => SessionInfoSheet(session: session),
      );

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final running = session.status == SessionStatus.running;
    final wsName = session.workspacePath.split('/')
        .lastWhere((p) => p.isNotEmpty, orElse: () => session.workspacePath);

    return Container(
      padding: EdgeInsets.fromLTRB(0, 0, 0, MediaQuery.of(context).padding.bottom + 8),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        // handle
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Center(child: Container(
            width: 36, height: 4,
            decoration: BoxDecoration(color: c.bg4, borderRadius: BorderRadius.circular(2)),
          )),
        ),

        // header row
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
          child: Row(children: [
            Expanded(child: Text('会话信息',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.fg))),
            CupertinoButton(
              padding: EdgeInsets.zero,
              onPressed: () => Navigator.of(context).pop(),
              child: Text('完成', style: TextStyle(fontSize: 15, color: c.tint)),
            ),
          ]),
        ),

        // status row
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
          child: Row(children: [
            Container(
              width: 10, height: 10,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: running ? AppColors.green : c.fg3,
              ),
            ),
            const SizedBox(width: 10),
            Text(wsName,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.fg)),
            const SizedBox(width: 8),
            _Pill(running ? '运行中' : '已完成',
              running ? AppColors.green : c.fg2,
              running ? AppColors.green.withValues(alpha: .15) : c.bg3),
            const Spacer(),
            Text(running ? '18 分钟' : '共 42 分钟',
              style: TextStyle(fontSize: 12, color: c.fg3)),
          ]),
        ),

        // stats card
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Container(
            decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
            child: Column(children: [
              _StatRow('模型', 'claude-sonnet-4-5', c, mono: false),
              _StatRow('设备', '💻 MacBook Pro', c, mono: false),
              _StatRow('输入 Token', '12,480', c),
              _StatRow('输出 Token', '3,214', c),
              _StatRow('工具调用', '7 次', c, last: true),
            ]),
          ),
        ),

        // files involved
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('涉及文件',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
                color: c.fg2, letterSpacing: .04 * 12)),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 4, children: [
              '📄 router.dart', '📄 chat_page.dart', '📄 main.dart',
            ].map((f) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: c.bg3, borderRadius: BorderRadius.circular(6)),
              child: Text(f,
                style: TextStyle(fontFamily: 'Menlo', fontSize: 12, color: c.fg2)),
            )).toList()),
          ]),
        ),

        const SizedBox(height: 14),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            Expanded(child: CupertinoButton(
              padding: const EdgeInsets.symmetric(vertical: 12),
              color: c.bg2,
              borderRadius: BorderRadius.circular(10),
              onPressed: () {},
              child: Text('复制会话 ID', style: TextStyle(fontSize: 13, color: c.fg)),
            )),
            const SizedBox(width: 8),
            Expanded(child: CupertinoButton(
              padding: const EdgeInsets.symmetric(vertical: 12),
              color: running ? AppColors.red.withValues(alpha: .12) : c.tintBg,
              borderRadius: BorderRadius.circular(10),
              onPressed: () {},
              child: Text(
                running ? '终止会话' : '查看历史',
                style: TextStyle(
                  fontSize: 13,
                  color: running ? AppColors.red : c.tint,
                  fontWeight: FontWeight.w600,
                ),
              ),
            )),
          ]),
        ),
        const SizedBox(height: 8),
      ]),
    );
  }
}

Widget _StatRow(String label, String value, ThemeColors c,
    {bool mono = true, bool last = false}) =>
  Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
    decoration: BoxDecoration(
      border: last ? null : Border(bottom: BorderSide(color: c.separator)),
    ),
    child: Row(children: [
      Expanded(child: Text(label, style: TextStyle(fontSize: 14, color: c.fg2))),
      Text(value, style: TextStyle(
        fontSize: 14, color: c.fg,
        fontFamily: mono ? 'Menlo' : null,
      )),
    ]),
  );

class _Pill extends StatelessWidget {
  const _Pill(this.text, this.color, this.bg);
  final String text;
  final Color color, bg;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
    child: Text(text,
      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
  );
}
