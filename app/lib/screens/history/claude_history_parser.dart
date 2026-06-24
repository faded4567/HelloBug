import 'dart:convert';

import '../../models/chat_item.dart';

List<ChatItem> parseClaudeHistoryLines(List<String> lines) {
  final items = <ChatItem>[];

  for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    final parsedItems = _parseHistoryLine(lines[lineIndex], lineIndex);
    for (final item in parsedItems) {
      if (_shouldMergeAssistantDelta(items, item)) {
        items[items.length - 1] = items.last.appendText(item.text ?? '');
        continue;
      }
      items.add(item);
    }
  }

  return items;
}

List<ChatItem> _parseHistoryLine(String line, int lineIndex) {
  try {
    final decoded = jsonDecode(line);
    if (decoded is! Map<String, dynamic>) {
      return const [];
    }

    final type = decoded['type'] as String?;
    switch (type) {
      case 'assistant':
        return _parseAssistantRecord(decoded, lineIndex);
      case 'user':
        return _parseUserRecord(decoded, lineIndex);
      default:
        return const [];
    }
  } catch (_) {
    return const [];
  }
}

List<ChatItem> _parseAssistantRecord(
  Map<String, dynamic> record,
  int lineIndex,
) {
  final items = <ChatItem>[];
  final contentEntries = _contentEntries(record);
  final directThinking = _stringOrNull(record['thinking']);
  final directText =
      _stringOrNull(record['text']) ?? _stringOrNull(record['delta']);

  if (directThinking != null && directThinking.isNotEmpty) {
    items.add(
      ChatItem(
        id: 'history-$lineIndex-thinking-direct',
        kind: ChatItemKind.thinking,
        text: directThinking,
      ),
    );
  }

  if (directText != null && directText.isNotEmpty) {
    items.add(
      ChatItem(
        id: 'history-$lineIndex-assistant-direct',
        kind: ChatItemKind.assistantDelta,
        text: directText,
      ),
    );
  }

  for (var entryIndex = 0; entryIndex < contentEntries.length; entryIndex++) {
    items.addAll(
      _parseContentEntry(
        contentEntries[entryIndex],
        lineIndex: lineIndex,
        entryIndex: entryIndex,
        isUser: false,
      ),
    );
  }

  return items;
}

List<ChatItem> _parseUserRecord(Map<String, dynamic> record, int lineIndex) {
  final items = <ChatItem>[];
  final contentEntries = _contentEntries(record);

  for (var entryIndex = 0; entryIndex < contentEntries.length; entryIndex++) {
    items.addAll(
      _parseContentEntry(
        contentEntries[entryIndex],
        lineIndex: lineIndex,
        entryIndex: entryIndex,
        isUser: true,
      ),
    );
  }

  return items;
}

List<ChatItem> _parseContentEntry(
  Object? rawEntry, {
  required int lineIndex,
  required int entryIndex,
  required bool isUser,
}) {
  if (rawEntry is! Map<String, dynamic>) {
    return const [];
  }

  final entryType = rawEntry['type'] as String?;
  final itemIdPrefix = 'history-$lineIndex-$entryIndex';

  switch (entryType) {
    case 'text':
      final text = _extractText(rawEntry);
      if (text == null || text.isEmpty) {
        return const [];
      }
      return [
        ChatItem(
          id: '$itemIdPrefix-text',
          kind: isUser ? ChatItemKind.user : ChatItemKind.assistantDelta,
          text: text,
        ),
      ];
    case 'thinking':
      final text = _extractText(rawEntry);
      if (text == null || text.isEmpty) {
        return const [];
      }
      return [
        ChatItem(
          id: '$itemIdPrefix-thinking',
          kind: ChatItemKind.thinking,
          text: text,
        ),
      ];
    case 'tool_use':
      final toolName =
          _stringOrNull(rawEntry['name']) ??
          _stringOrNull(rawEntry['tool_name']);
      if (toolName == null || toolName.isEmpty) {
        return const [];
      }
      return [
        ChatItem(
          id: '$itemIdPrefix-tool-use',
          kind: ChatItemKind.toolUse,
          toolName: toolName,
          text: _stringifyValue(
            rawEntry['input'] ?? rawEntry['tool_input'] ?? const {},
          ),
        ),
      ];
    case 'tool_result':
      return [
        ChatItem(
          id: '$itemIdPrefix-tool-result',
          kind: ChatItemKind.toolResult,
          toolName:
              _stringOrNull(rawEntry['name']) ??
              _stringOrNull(rawEntry['tool_name']),
          text: _stringifyValue(
            rawEntry['content'] ??
                rawEntry['output'] ??
                rawEntry['result'] ??
                '',
          ),
        ),
      ];
    default:
      final fallbackText = _extractText(rawEntry);
      if (fallbackText == null || fallbackText.isEmpty) {
        return const [];
      }
      return [
        ChatItem(
          id: '$itemIdPrefix-fallback',
          kind: isUser ? ChatItemKind.user : ChatItemKind.assistantDelta,
          text: fallbackText,
        ),
      ];
  }
}

List<Object?> _contentEntries(Map<String, dynamic> record) {
  final directContent = record['content'];
  if (directContent is List<Object?>) {
    return directContent;
  }

  final message = record['message'];
  if (message is Map<String, dynamic>) {
    final content = message['content'];
    if (content is List<Object?>) {
      return content;
    }
  }

  final delta = record['delta'];
  if (delta is Map<String, dynamic>) {
    final content = delta['content'];
    if (content is List<Object?>) {
      return content;
    }
  }

  return const [];
}

String? _extractText(Map<String, dynamic> record) {
  return _stringOrNull(record['text']) ??
      _stringOrNull(record['delta']) ??
      _stringOrNull(record['content']) ??
      _stringOrNull(record['value']);
}

String? _stringOrNull(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  return null;
}

String _stringifyValue(Object? value) {
  if (value == null) {
    return '';
  }

  if (value is String) {
    return value;
  }

  if (value is List) {
    final textSegments =
        value
            .map((entry) {
              if (entry is Map<String, dynamic>) {
                return _extractText(entry);
              }
              return entry?.toString();
            })
            .whereType<String>()
            .where((segment) => segment.isNotEmpty)
            .toList();
    if (textSegments.isNotEmpty) {
      return textSegments.join('\n');
    }
  }

  try {
    return jsonEncode(value);
  } catch (_) {
    return value.toString();
  }
}

bool _shouldMergeAssistantDelta(List<ChatItem> items, ChatItem next) {
  return items.isNotEmpty &&
      items.last.kind == ChatItemKind.assistantDelta &&
      next.kind == ChatItemKind.assistantDelta &&
      (next.text?.isNotEmpty ?? false);
}
