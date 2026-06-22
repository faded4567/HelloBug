import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/chat_item.dart';
import '../models/inner_message.dart';
import '../transport/ws_provider.dart';

final chatProvider =
    NotifierProvider<ChatNotifier, Map<String, List<ChatItem>>>(ChatNotifier.new);

class ChatNotifier extends Notifier<Map<String, List<ChatItem>>> {
  @override
  Map<String, List<ChatItem>> build() {
    final client = ref.watch(wsClientProvider);
    if (client != null) {
      final sub = client.messages.listen(_handle);
      ref.onDispose(sub.cancel);
    }
    return {};
  }

  void _handle(InnerMessage msg) {
    if (msg.type != 'session.event') return;
    final sid = msg.payload['session_id'] as String? ?? '';
    final evType = msg.payload['event_type'] as String? ?? '';
    final current = List<ChatItem>.from(state[sid] ?? []);

    switch (evType) {
      case 'assistant.delta':
        final text = msg.payload['text'] as String? ?? '';
        final lastIdx = current.lastIndexWhere((i) => i.kind == ChatItemKind.assistantDelta);
        if (lastIdx >= 0) {
          current[lastIdx] = current[lastIdx].appendText(text);
          state = {...state, sid: current};
          return;
        }
        current.add(ChatItem(id: _id(), kind: ChatItemKind.assistantDelta, text: text));
      case 'assistant.thinking':
        current.add(ChatItem(id: _id(), kind: ChatItemKind.thinking, text: msg.payload['thinking'] as String? ?? ''));
      case 'tool.use':
        current.add(ChatItem(id: _id(), kind: ChatItemKind.toolUse, toolName: msg.payload['name'] as String? ?? ''));
      case 'tool.result':
        current.add(ChatItem(id: _id(), kind: ChatItemKind.toolResult, text: msg.payload['output'] as String? ?? '', toolName: msg.payload['tool_use_id'] as String?));
      case 'file.changed':
        current.add(ChatItem(id: _id(), kind: ChatItemKind.fileChanged, filePath: msg.payload['file_path'] as String? ?? '', diff: msg.payload['diff'] as String? ?? ''));
      case 'session.done':
        current.add(ChatItem(id: _id(), kind: ChatItemKind.done));
      default:
        return;
    }
    state = {...state, sid: current};
  }

  // Optimistic echo for outgoing user messages.
  void addUserMessage(String sessionId, String text) {
    final current = List<ChatItem>.from(state[sessionId] ?? []);
    current.add(ChatItem(id: _id(), kind: ChatItemKind.user, text: text));
    state = {...state, sessionId: current};
  }

  String _id() => DateTime.now().microsecondsSinceEpoch.toString();
}
