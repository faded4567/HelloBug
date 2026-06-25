class DangerResult {
  const DangerResult({
    required this.dangerId,
    required this.sessionId,
    required this.status,
    required this.message,
  });

  final String dangerId;
  final String sessionId;
  final String status;
  final String message;

  bool get isTerminal => true;

  bool get isSuccess => status == 'approved' || status == 'denied';

  bool get shouldAlertGlobally =>
      status == 'timed_out' ||
      status == 'not_found' ||
      status == 'biometric_required';

  factory DangerResult.fromPayload(Map<String, dynamic> payload) {
    return DangerResult(
      dangerId: payload['danger_id'] as String? ?? '',
      sessionId: payload['session_id'] as String? ?? '',
      status: payload['status'] as String? ?? 'not_found',
      message: payload['message'] as String? ?? '',
    );
  }
}
