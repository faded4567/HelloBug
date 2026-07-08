enum ChatItemKind { user, assistantDelta, toolUse, toolResult, thinking, fileChanged, done, usage }

class ChatItem {
  const ChatItem({
    required this.id,
    required this.kind,
    this.text,
    this.toolName,
    this.filePath,
    this.diff,
    this.createdAt,
    this.inputTokens,
    this.outputTokens,
  });

  final String id;
  final ChatItemKind kind;
  final String? text;
  final String? toolName;
  final String? filePath;
  final String? diff;
  final DateTime? createdAt;
  final int? inputTokens;
  final int? outputTokens;

  ChatItem appendText(String delta) => ChatItem(
        id: id, kind: kind, toolName: toolName, filePath: filePath, diff: diff, createdAt: createdAt,
        inputTokens: inputTokens, outputTokens: outputTokens,
        text: (text ?? '') + delta,
      );
}
