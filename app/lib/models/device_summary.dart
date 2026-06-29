class DeviceSummary {
  final String deviceId;
  final String machineName;
  final String os;
  final String daemonVersion;
  final bool online;
  final int activeSessions;
  final DateTime? pairedAt;
  final DateTime? lastSeen;
  final DateTime? revokedAt;

  const DeviceSummary({
    required this.deviceId,
    required this.machineName,
    required this.os,
    this.daemonVersion = '',
    required this.online,
    this.activeSessions = 0,
    this.pairedAt,
    this.lastSeen,
    this.revokedAt,
  });

  factory DeviceSummary.fromStatusPayload(Map<String, dynamic> p) =>
      DeviceSummary(
        deviceId: p['device_id'] as String,
        machineName: p['machine_name'] as String? ?? '',
        os: p['os'] as String? ?? '',
        daemonVersion: p['daemon_version'] as String? ?? '',
        online: p['online'] as bool? ?? false,
        activeSessions: (p['active_session_count'] as num?)?.toInt() ?? 0,
        pairedAt: _dateFromEpochMs(p['paired_at']),
        lastSeen: _dateFromEpochMs(p['last_seen_at'] ?? p['ts']),
        revokedAt: _dateFromEpochMs(p['revoked_at']),
      );

  factory DeviceSummary.fromListPayload(Map<String, dynamic> p) =>
      DeviceSummary(
        deviceId: p['device_id'] as String,
        machineName: p['machine_name'] as String? ?? '',
        os: p['os'] as String? ?? '',
        daemonVersion: p['daemon_version'] as String? ?? '',
        online: p['online'] as bool? ?? false,
        activeSessions: (p['active_session_count'] as num?)?.toInt() ?? 0,
        pairedAt: _dateFromEpochMs(p['paired_at']),
        lastSeen: _dateFromEpochMs(p['last_seen_at']),
        revokedAt: _dateFromEpochMs(p['revoked_at']),
      );

  static List<DeviceSummary> listFromPayload(dynamic raw) {
    if (raw is! List) {
      return const <DeviceSummary>[];
    }
    return raw
        .whereType<Map>()
        .map(
          (item) => DeviceSummary.fromListPayload(
            item.map((key, value) => MapEntry('$key', value)),
          ),
        )
        .toList(growable: false);
  }

  bool get isRevoked => revokedAt != null;

  DeviceSummary copyWith({
    String? machineName,
    String? os,
    String? daemonVersion,
    bool? online,
    int? activeSessions,
    DateTime? pairedAt,
    DateTime? lastSeen,
    DateTime? revokedAt,
  }) => DeviceSummary(
    deviceId: deviceId,
    machineName: machineName ?? this.machineName,
    os: os ?? this.os,
    daemonVersion: daemonVersion ?? this.daemonVersion,
    online: online ?? this.online,
    activeSessions: activeSessions ?? this.activeSessions,
    pairedAt: pairedAt ?? this.pairedAt,
    lastSeen: lastSeen ?? this.lastSeen,
    revokedAt: revokedAt ?? this.revokedAt,
  );

  DeviceSummary merge(DeviceSummary incoming) => copyWith(
    machineName:
        incoming.machineName.isNotEmpty ? incoming.machineName : machineName,
    os: incoming.os.isNotEmpty ? incoming.os : os,
    daemonVersion:
        incoming.daemonVersion.isNotEmpty
            ? incoming.daemonVersion
            : daemonVersion,
    online: incoming.online,
    activeSessions: incoming.activeSessions,
    pairedAt: incoming.pairedAt ?? pairedAt,
    lastSeen: incoming.lastSeen ?? lastSeen,
    revokedAt: incoming.revokedAt ?? revokedAt,
  );

  DeviceSummary mergePresence(DeviceSummary incoming) => copyWith(
    machineName:
        incoming.machineName.isNotEmpty ? incoming.machineName : machineName,
    os: incoming.os.isNotEmpty ? incoming.os : os,
    daemonVersion:
        incoming.daemonVersion.isNotEmpty
            ? incoming.daemonVersion
            : daemonVersion,
    online: incoming.online,
    activeSessions: incoming.activeSessions,
    pairedAt: incoming.pairedAt ?? pairedAt,
    lastSeen: incoming.lastSeen ?? lastSeen,
    revokedAt: incoming.revokedAt ?? revokedAt,
  );
}

DateTime? _dateFromEpochMs(Object? raw) {
  final value = (raw as num?)?.toInt();
  if (value == null || value <= 0) {
    return null;
  }
  return DateTime.fromMillisecondsSinceEpoch(value);
}
