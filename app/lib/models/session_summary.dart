enum SessionStatus { running, replaying, done, offline }

class SessionSummary {
  const SessionSummary({
    required this.sessionId,
    required this.deviceId,
    required this.workspacePath,
    required this.agentType,
    this.status = SessionStatus.done,
    this.lastPreview = '',
    this.unread = 0,
    this.startedAt,
  });

  final String sessionId;
  final String deviceId;
  final String workspacePath;
  final String agentType; // 'claude_code' | 'codex' | 'shell'
  final SessionStatus status;
  final String lastPreview;
  final int unread;
  final DateTime? startedAt;

  SessionSummary copyWith({
    SessionStatus? status,
    String? lastPreview,
    int? unread,
  }) =>
      SessionSummary(
        sessionId: sessionId, deviceId: deviceId,
        workspacePath: workspacePath, agentType: agentType,
        startedAt: startedAt,
        status: status ?? this.status,
        lastPreview: lastPreview ?? this.lastPreview,
        unread: unread ?? this.unread,
      );
}
