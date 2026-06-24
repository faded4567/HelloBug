class DangerRequest {
  final String dangerId;
  final String sessionId;
  final String command;
  final String ruleName;
  final String workspacePath;
  final DateTime timeoutAt;

  const DangerRequest({
    required this.dangerId,
    required this.sessionId,
    required this.command,
    required this.ruleName,
    required this.workspacePath,
    required this.timeoutAt,
  });

  factory DangerRequest.fromPayload(Map<String, dynamic> p) => DangerRequest(
    dangerId: p['danger_id'] as String? ?? '',
    sessionId: p['session_id'] as String? ?? '',
    command: p['command'] as String? ?? '',
    ruleName: p['rule_matched'] as String? ?? '',
    workspacePath: p['workspace'] as String? ?? '',
    timeoutAt: DateTime.fromMillisecondsSinceEpoch(
      (p['timeout_at'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
    ),
  );
}
