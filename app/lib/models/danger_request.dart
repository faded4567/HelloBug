class DangerRequest {
  final String sessionId;
  final String command;
  final String ruleName;
  final String workspacePath;
  final DateTime receivedAt;

  const DangerRequest({
    required this.sessionId,
    required this.command,
    required this.ruleName,
    required this.workspacePath,
    required this.receivedAt,
  });
}
