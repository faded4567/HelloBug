import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import '../../theme/index.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.text, required this.isUser, this.isStreaming = false, this.createdAt});
  final String text;
  final bool isUser;
  final bool isStreaming;
  final DateTime? createdAt;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return GestureDetector(
      onLongPress: () {
        Clipboard.setData(ClipboardData(text: text));
        showCupertinoModalPopup<void>(
          context: context,
          builder: (_) => CupertinoActionSheet(
            message: Text(text.length > 80 ? '${text.substring(0, 80)}...' : text, style: TextStyle(fontSize: 12, color: CupertinoColors.secondaryLabel.resolveFrom(context))),
            actions: [
              CupertinoActionSheetAction(onPressed: () => Navigator.pop(context), child: const Text('已复制到剪贴板')),
            ],
          ),
        );
      },
      child: Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.only(
          top: 4, bottom: 4,
          left: isUser ? 60 : 0,
          right: isUser ? 0 : 60,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isUser ? c.bubbleMe : c.bubbleAi,
          borderRadius: BorderRadius.only(
            topLeft: AppRadius.lg,
            topRight: AppRadius.lg,
            bottomLeft: isUser ? AppRadius.lg : AppRadius.sm,
            bottomRight: isUser ? AppRadius.sm : AppRadius.lg,
          ),
        ),
        child: Column(
          crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              text.isEmpty ? ' ' : text,
              style: TextStyle(fontSize: 15, color: isUser ? const Color(0xFFFFFFFF) : c.fg, height: 1.45),
            ),
            if (createdAt != null) ...[
              const SizedBox(height: 4),
              Text(
                '${createdAt!.hour.toString().padLeft(2, '0')}:${createdAt!.minute.toString().padLeft(2, '0')}',
                style: TextStyle(fontSize: 10, color: isUser ? const Color(0x88FFFFFF) : c.fg3),
              ),
            ],
            if (isStreaming) Container(width: 6, height: 14, color: c.tint, margin: const EdgeInsets.only(top: 4)),
          ],
        ),
      ),
      ),
    );
  }
}
