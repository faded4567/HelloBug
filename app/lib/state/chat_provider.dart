import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/chat_item.dart';
import '../models/inner_message.dart';
import '../transport/ws_provider.dart';

final chatProvider =
    NotifierProvider<ChatNotifier, Map<String, List<ChatItem>>>(
      ChatNotifier.new,
    );

class ChatNotifier extends Notifier<Map<String, List<ChatItem>>> {
  StreamSubscription<InnerMessage>? _subscription;

  @override
  Map<String, List<ChatItem>> build() {
    _subscription?.cancel();
    final client = ref.watch(wsClientProvider);
    if (client != null) {
      _subscription = client.messages.listen(_handle);
    }
    ref.onDispose(() => _subscription?.cancel());
    return {};
  }

  void _handle(InnerMessage msg) {
    if (msg.type != 'session.event') return;
    final sid = msg.payload['session_id'] as String? ?? '';
    final event = msg.payload['event'];
    if (sid.isEmpty || event is! Map) return;
    final eventMap = Map<String, dynamic>.from(event);
    final evType = eventMap['event_type'] as String? ?? '';
    final current = List<ChatItem>.from(state[sid] ?? []);

    switch (evType) {
      case 'assistant.delta':
        final text = eventMap['text'] as String? ?? '';
        final lastIdx = current.lastIndexWhere(
          (i) => i.kind == ChatItemKind.assistantDelta,
        );
        if (lastIdx >= 0) {
          current[lastIdx] = current[lastIdx].appendText(text);
          state = {...state, sid: current};
          return;
        }
        current.add(
          ChatItem(id: _id(), kind: ChatItemKind.assistantDelta, text: text),
        );
        break;
      case 'assistant.thinking':
        current.add(
          ChatItem(
            id: _id(),
            kind: ChatItemKind.thinking,
            text: eventMap['text'] as String? ?? '',
          ),
        );
        break;
      case 'tool.use':
        current.add(
          ChatItem(
            id: _id(),
            kind: ChatItemKind.toolUse,
            toolName: eventMap['tool_name'] as String? ?? '',
            text: _formatToolInput(eventMap['tool_input']),
          ),
        );
        break;
      case 'tool.result':
        current.add(
          ChatItem(
            id: _id(),
            kind: ChatItemKind.toolResult,
            text: eventMap['content'] as String? ?? '',
            toolName: eventMap['tool_name'] as String?,
          ),
        );
        break;
      case 'file.changed':
        current.add(
          ChatItem(
            id: _id(),
            kind: ChatItemKind.fileChanged,
            filePath: eventMap['file_path'] as String? ?? '',
            diff: eventMap['diff'] as String? ?? '',
          ),
        );
        break;
      case 'session.done':
        current.add(ChatItem(id: _id(), kind: ChatItemKind.done));
        break;
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

  String? _formatToolInput(Object? raw) {
    if (raw == null) {
      return null;
    }
    if (raw is String) {
      return raw;
    }
    try {
      return const JsonEncoder.withIndent('  ').convert(raw);
    } catch (_) {
      return raw.toString();
    }
  }
}
