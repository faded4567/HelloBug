import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import '../../theme/index.dart';

enum MessageActionsType { ai, user, tool }

class MessageActionsSheet extends StatelessWidget {
  const MessageActionsSheet({
    super.key,
    required this.type,
    required this.preview,
    this.onQuote,
    this.onDelete,
  });
  final MessageActionsType type;
  final String preview;
  final VoidCallback? onQuote;
  final VoidCallback? onDelete;

  static Future<void> show(
    BuildContext context, {
    required MessageActionsType type,
    required String preview,
    VoidCallback? onQuote,
    VoidCallback? onDelete,
  }) =>
      showCupertinoModalPopup<void>(
        context: context,
        builder: (_) => MessageActionsSheet(
          type: type, preview: preview, onQuote: onQuote, onDelete: onDelete),
      );

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Center(child: Container(
            width: 36, height: 4,
            decoration: BoxDecoration(color: c.bg4, borderRadius: BorderRadius.circular(2)),
          )),
        ),

        // preview
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: c.bg2,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: c.tint, width: 1),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(type == MessageActionsType.user ? '你' : 'Claude Code',
                style: TextStyle(fontSize: 12, color: c.fg3)),
              const SizedBox(height: 4),
              Text(preview, maxLines: 3, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 14, color: c.fg, height: 1.5)),
            ]),
          ),
        ),

        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
          child: Text(type == MessageActionsType.tool ? '工具操作' : '消息操作',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.fg)),
        ),
        const SizedBox(height: 8),

        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Container(
            decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
            child: Column(children: _actions(context, c)),
          ),
        ),

        if (type == MessageActionsType.user) ...[
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Container(
              decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
              child: _ActionRow('🗑', '删除此消息', c,
                color: AppColors.red,
                onTap: () { onDelete?.call(); Navigator.of(context).pop(); }),
            ),
          ),
        ],

        SizedBox(height: MediaQuery.of(context).padding.bottom + 20),
      ]),
    );
  }

  List<Widget> _actions(BuildContext context, ThemeColors c) {
    switch (type) {
      case MessageActionsType.ai:
        return [
          _ActionRow('📋', '复制文本', c, onTap: () {
            Clipboard.setData(ClipboardData(text: preview));
            Navigator.of(context).pop();
          }),
          _ActionRow('🔗', '复制消息链接', c, onTap: () => Navigator.of(context).pop()),
          _ActionRow('💬', '引用回复', c, onTap: () {
            onQuote?.call();
            Navigator.of(context).pop();
          }),
          _ActionRow('📤', '分享', c, onTap: () => Navigator.of(context).pop()),
          _ActionRow('🔍', '在历史中定位', c, last: true,
            onTap: () => Navigator.of(context).pop()),
        ];
      case MessageActionsType.user:
        return [
          _ActionRow('📋', '复制文本', c, onTap: () {
            Clipboard.setData(ClipboardData(text: preview));
            Navigator.of(context).pop();
          }),
          _ActionRow('✏️', '编辑后重新发送', c, onTap: () => Navigator.of(context).pop()),
          _ActionRow('🔁', '重新发送', c, onTap: () => Navigator.of(context).pop()),
          _ActionRow('📤', '分享', c, last: true, onTap: () => Navigator.of(context).pop()),
        ];
      case MessageActionsType.tool:
        return [
          _ActionRow('🔍', '查看 Diff', c, onTap: () => Navigator.of(context).pop()),
          _ActionRow('📁', '在文件树中定位', c, onTap: () => Navigator.of(context).pop()),
          _ActionRow('📋', '复制文件路径', c, onTap: () {
            Clipboard.setData(ClipboardData(text: preview));
            Navigator.of(context).pop();
          }),
          _ActionRow('🕐', '在历史中查看', c, last: true,
            onTap: () => Navigator.of(context).pop()),
        ];
    }
  }
}

Widget _ActionRow(String icon, String label, ThemeColors c,
    {Color? color, bool last = false, VoidCallback? onTap}) =>
  GestureDetector(
    onTap: onTap,
    behavior: HitTestBehavior.opaque,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        border: last ? null : Border(bottom: BorderSide(color: c.separator)),
      ),
      child: Row(children: [
        Text(icon, style: const TextStyle(fontSize: 20)),
        const SizedBox(width: 14),
        Text(label, style: TextStyle(fontSize: 16,
          color: color ?? c.fg)),
      ]),
    ),
  );
