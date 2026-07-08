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
    this.claudeSessionId,
  });

  final String sessionId;
  final String deviceId;
  final String workspacePath;
  final String agentType;
  final SessionStatus status;
  final String lastPreview;
  final int unread;
  final DateTime? startedAt;
  final String? claudeSessionId;

  SessionSummary copyWith({
    SessionStatus? status,
    String? lastPreview,
    int? unread,
    String? claudeSessionId,
  }) =>
      SessionSummary(
        sessionId: sessionId, deviceId: deviceId,
        workspacePath: workspacePath, agentType: agentType,
        startedAt: startedAt,
        status: status ?? this.status,
        lastPreview: lastPreview ?? this.lastPreview,
        unread: unread ?? this.unread,
        claudeSessionId: claudeSessionId ?? this.claudeSessionId,
      );

  Map<String, dynamic> toJson() => {
    'session_id': sessionId,
    'device_id': deviceId,
    'workspace_path': workspacePath,
    'agent_type': agentType,
    'status': status.name,
    'last_preview': lastPreview,
    'unread': unread,
    if (startedAt != null) 'started_at': startedAt!.toIso8601String(),
    if (claudeSessionId != null) 'claude_session_id': claudeSessionId,
  };

  factory SessionSummary.fromJson(Map<String, dynamic> json) =>
      SessionSummary(
        sessionId: json['session_id'] as String,
        deviceId: json['device_id'] as String? ?? '',
        workspacePath: json['workspace_path'] as String? ?? '',
        agentType: json['agent_type'] as String? ?? 'claude_code',
        status: SessionStatus.values.firstWhere(
          (s) => s.name == json['status'],
          orElse: () => SessionStatus.offline,
        ),
        lastPreview: json['last_preview'] as String? ?? '',
        unread: (json['unread'] as num?)?.toInt() ?? 0,
        startedAt: json['started_at'] != null
            ? DateTime.tryParse(json['started_at'] as String)
            : null,
        claudeSessionId: json['claude_session_id'] as String?,
      );
}
