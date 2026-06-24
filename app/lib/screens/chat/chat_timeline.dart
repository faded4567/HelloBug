import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/chat_item.dart';
import '../../state/chat_provider.dart';
import '../../theme/index.dart';
import '../../widgets/message_bubble.dart';
import '../../widgets/tool_use_card.dart';
import '../../widgets/thinking_card.dart';
import '../../widgets/diff_card.dart';

class ChatTimeline extends ConsumerStatefulWidget {
  const ChatTimeline({super.key, required this.sessionId});
  final String sessionId;

  @override
  ConsumerState<ChatTimeline> createState() => _ChatTimelineState();
}

class _ChatTimelineState extends ConsumerState<ChatTimeline> {
  final _scroll = ScrollController();
  bool _atBottom = true;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      final atBottom = _scroll.position.pixels >= _scroll.position.maxScrollExtent - 60;
      if (atBottom != _atBottom) setState(() => _atBottom = atBottom);
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    if (_scroll.hasClients) {
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = ref.watch(chatProvider.select((m) => m[widget.sessionId] ?? const []));
    // auto-scroll when new messages arrive and user is at bottom
    ref.listen(chatProvider.select((m) => m[widget.sessionId]?.length ?? 0), (prev, next) {
      if (_atBottom && next > (prev ?? 0)) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
      }
    });

    final c = context.colors;
    if (items.isEmpty) {
      return Center(child: Text('暂无消息', style: TextStyle(fontSize: 15, color: c.fg3)));
    }

    final showTyping = items.last.kind == ChatItemKind.user;
    final count = items.length + (showTyping ? 1 : 0);

    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      itemCount: count,
      itemBuilder: (ctx, i) {
        if (i == items.length && showTyping) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: CupertinoActivityIndicator(),
          );
        }
        return _ChatItemWidget(item: items[i], isLast: i == items.length - 1);
      },
    );
  }
}

class _ChatItemWidget extends StatelessWidget {
  const _ChatItemWidget({required this.item, required this.isLast});
  final ChatItem item;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return switch (item.kind) {
      ChatItemKind.user => MessageBubble(text: item.text ?? '', isUser: true),
      ChatItemKind.assistantDelta => MessageBubble(
          text: item.text ?? '',
          isUser: false,
          isStreaming: isLast,
        ),
      ChatItemKind.toolUse => Padding(
          padding: const EdgeInsets.only(left: 4),
          child: ToolUseCard(toolName: item.toolName ?? '', input: item.text),
        ),
      ChatItemKind.toolResult => Padding(
          padding: const EdgeInsets.only(left: 4),
          child: ToolResultCard(output: item.text ?? ''),
        ),
      ChatItemKind.thinking => Padding(
          padding: const EdgeInsets.only(left: 4),
          child: ThinkingCard(thinking: item.text ?? ''),
        ),
      ChatItemKind.fileChanged => Padding(
          padding: const EdgeInsets.only(left: 4),
          child: DiffCard(filePath: item.filePath ?? '', diff: item.diff ?? ''),
        ),
      ChatItemKind.done => Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('— 会话结束 —',
              style: TextStyle(fontSize: 13, color: c.fg3)),
          ),
        ),
    };
  }
}
