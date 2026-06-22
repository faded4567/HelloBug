import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.text, required this.isUser, this.isStreaming = false});
  final String text;
  final bool isUser;
  final bool isStreaming;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Align(
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
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Flexible(child: Text(
              text.isEmpty ? ' ' : text,
              style: TextStyle(fontSize: 15, color: isUser ? const Color(0xFFFFFFFF) : c.fg, height: 1.45),
            )),
            if (isStreaming) ...[
              const SizedBox(width: 4),
              Container(
                width: 6, height: 14,
                color: c.tint,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
