enum ChatItemKind { user, assistantDelta, toolUse, toolResult, thinking, fileChanged, done }

class ChatItem {
  const ChatItem({
    required this.id,
    required this.kind,
    this.text,
    this.toolName,
    this.filePath,
    this.diff,
  });

  final String id;
  final ChatItemKind kind;
  final String? text;      // user / assistantDelta / thinking / toolResult
  final String? toolName;  // toolUse / toolResult (tool_use_id)
  final String? filePath;  // fileChanged
  final String? diff;      // fileChanged

  ChatItem appendText(String delta) => ChatItem(
        id: id, kind: kind, toolName: toolName, filePath: filePath, diff: diff,
        text: (text ?? '') + delta,
      );
}
