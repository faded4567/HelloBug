import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class MessageActionsSheet extends StatelessWidget {
  const MessageActionsSheet({super.key, required this.text, this.onCopy, this.onRetry});
  final String text;
  final VoidCallback? onCopy;
  final VoidCallback? onRetry;

  static Future<void> show(BuildContext context,
      {required String text, VoidCallback? onCopy, VoidCallback? onRetry}) =>
      showCupertinoModalPopup<void>(
        context: context,
        builder: (_) => MessageActionsSheet(text: text, onCopy: onCopy, onRetry: onRetry),
      );

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoActionSheet(
      actions: [
        CupertinoActionSheetAction(
          onPressed: () { Navigator.of(context).pop(); onCopy?.call(); },
          child: const Text('复制'),
        ),
        CupertinoActionSheetAction(
          onPressed: () { Navigator.of(context).pop(); onRetry?.call(); },
          child: const Text('重新生成'),
        ),
        CupertinoActionSheetAction(
          onPressed: () {
            Navigator.of(context).pop();
            _showRaw(context, c, text);
          },
          child: const Text('查看原始 Markdown'),
        ),
      ],
      cancelButton: CupertinoActionSheetAction(
        isDefaultAction: true,
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('取消'),
      ),
    );
  }

  void _showRaw(BuildContext context, ThemeColors c, String text) {
    showCupertinoModalPopup<void>(
      context: context,
      builder: (_) => Container(
        height: 400,
        decoration: BoxDecoration(
          color: c.bg,
          borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
        ),
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 4, 0),
            child: Row(children: [
              Expanded(child: Text('原始内容',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: c.fg))),
              CupertinoButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text('关闭', style: TextStyle(color: c.tint)),
              ),
            ]),
          ),
          Expanded(child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Text(text,
              style: TextStyle(fontFamily: 'Menlo', fontSize: 13, color: c.fg, height: 1.5)),
          )),
        ]),
      ),
    );
  }
}
