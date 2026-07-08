import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/chat_item.dart';
import '../models/inner_message.dart';
import '../transport/ws_client.dart';
import '../transport/ws_provider.dart';

final chatProvider =
    NotifierProvider<ChatNotifier, Map<String, List<ChatItem>>>(
      ChatNotifier.new,
    );

class ChatNotifier extends Notifier<Map<String, List<ChatItem>>> {
  StreamSubscription<InnerMessage>? _subscription;
  WsClient? _client;

  @override
  Map<String, List<ChatItem>> build() {
    _subscription?.cancel();
    _client = ref.watch(wsClientProvider);
    if (_client != null) {
      _subscription = _client!.messages.listen(_handle);
    }
    ref.onDispose(() => _subscription?.cancel());
    return {};
  }

  /// Load chat history from daemon transcripts for a completed session.
  Future<void> loadHistory(String sessionId, String workspacePath) async {
    final client = _client ?? ref.read(wsClientProvider);
    if (client == null) return;

    final request = InnerMessage.create('history.get', {
      'session_id': sessionId,
      'workspace_path': workspacePath,
      'offset': 0,
      'limit': 200,
    });

    try {
      final response = await client.messages
          .firstWhere(
            (m) => m.type == 'history.get' && m.payload['request_id'] == request.id,
          )
          .timeout(const Duration(seconds: 10));
      await client.send(request);

      final lines = response.payload['lines'];
      if (lines is! List) return;

      final items = <ChatItem>[];
      for (final line in lines) {
        if (line is! String) continue;
        try {
          final entry = jsonDecode(line) as Map<String, dynamic>;
          final type = entry['type'] as String? ?? '';
          if (type == 'user') {
            final content = entry['message']?['content'];
            final text = _extractContentText(content);
            if (text.isNotEmpty) {
              items.add(ChatItem(id: _id(), kind: ChatItemKind.user, text: text));
            }
          } else if (type == 'assistant') {
            final content = entry['message']?['content'];
            final text = _extractContentText(content);
            if (text.isNotEmpty) {
              items.add(ChatItem(id: _id(), kind: ChatItemKind.assistantDelta, text: text));
            }
          } else if (type == 'thinking') {
            final thinking = entry['thinking'] as String? ?? '';
            if (thinking.isNotEmpty) {
              items.add(ChatItem(id: _id(), kind: ChatItemKind.thinking, text: thinking));
            }
          }
        } catch (_) {
          // Skip malformed lines
        }
      }

      if (items.isNotEmpty) {
        state = {...state, sessionId: items};
      }
    } catch (_) {
      // History might not be available yet
    }
  }

  String _extractContentText(dynamic content) {
    if (content is String) return content;
    if (content is List) {
      return content
          .whereType<Map<String, dynamic>>()
          .where((b) => b['type'] == 'text')
          .map((b) => b['text'] as String? ?? '')
          .join('\n');
    }
    return '';
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
        // Check if there's a user message after the last assistant delta
        // (meaning a new question was asked → start a new answer bubble)
        final lastUserIdx = current.lastIndexWhere(
          (i) => i.kind == ChatItemKind.user,
        );
        final lastDeltaIdx = current.lastIndexWhere(
          (i) => i.kind == ChatItemKind.assistantDelta,
        );
        if (lastDeltaIdx >= 0 && lastUserIdx < lastDeltaIdx) {
          // Append to existing assistant bubble (same turn)
          current[lastDeltaIdx] = current[lastDeltaIdx].appendText(text);
          state = {...state, sid: current};
          return;
        }
        // New turn: create fresh assistant bubble
        current.add(
          _item(ChatItemKind.assistantDelta, text: text),
        );
        break;
      case 'assistant.thinking':
        current.add(
          _item(ChatItemKind.thinking, text: eventMap['text'] as String? ?? ''),
        );
        break;
      case 'tool.use':
        current.add(
          _item(ChatItemKind.toolUse, toolName: eventMap['tool_name'] as String? ?? '', text: _formatToolInput(eventMap['tool_input'])),
        );
        break;
      case 'tool.result':
        current.add(
          _item(ChatItemKind.toolResult, text: eventMap['content'] as String? ?? '', toolName: eventMap['tool_name'] as String?),
        );
        break;
      case 'file.changed':
        current.add(
          _item(ChatItemKind.fileChanged, filePath: eventMap['file_path'] as String? ?? '', diff: eventMap['diff'] as String? ?? ''),
        );
        break;
      case 'session.done':
        current.add(_item(ChatItemKind.done));
        break;
      case 'session.usage':
        current.add(_item(ChatItemKind.usage,
          inputTokens: (eventMap['input_tokens'] as num?)?.toInt(),
          outputTokens: (eventMap['output_tokens'] as num?)?.toInt(),
        ));
        break;
      default:
        return;
    }
    state = {...state, sid: current};
  }

  // Optimistic echo for outgoing user messages.
  void addUserMessage(String sessionId, String text) {
    final current = List<ChatItem>.from(state[sessionId] ?? []);
    current.add(ChatItem(id: _id(), kind: ChatItemKind.user, text: text, createdAt: DateTime.now()));
    state = {...state, sessionId: current};
  }

  String _id() => DateTime.now().microsecondsSinceEpoch.toString();

  ChatItem _item(ChatItemKind kind, {String? text, String? toolName, String? filePath, String? diff, int? inputTokens, int? outputTokens}) => ChatItem(
    id: _id(), kind: kind, text: text, toolName: toolName, filePath: filePath, diff: diff, createdAt: DateTime.now(),
    inputTokens: inputTokens, outputTokens: outputTokens,
  );

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
