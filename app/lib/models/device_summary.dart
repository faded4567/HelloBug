class DeviceSummary {
  final String deviceId;
  final String machineName;
  final String os;
  final bool online;
  final int activeSessions;
  final DateTime? lastSeen;

  const DeviceSummary({
    required this.deviceId,
    required this.machineName,
    required this.os,
    required this.online,
    this.activeSessions = 0,
    this.lastSeen,
  });

  factory DeviceSummary.fromStatusPayload(Map<String, dynamic> p) =>
      DeviceSummary(
        deviceId: p['device_id'] as String,
        machineName: p['machine_name'] as String? ?? '',
        os: '',
        online: p['online'] as bool? ?? false,
        lastSeen: p['ts'] != null
            ? DateTime.fromMillisecondsSinceEpoch(p['ts'] as int)
            : null,
      );

  DeviceSummary copyWith({bool? online, int? activeSessions, DateTime? lastSeen}) =>
      DeviceSummary(
        deviceId: deviceId,
        machineName: machineName,
        os: os,
        online: online ?? this.online,
        activeSessions: activeSessions ?? this.activeSessions,
        lastSeen: lastSeen ?? this.lastSeen,
      );
}
