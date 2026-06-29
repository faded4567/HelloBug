enum WorkspaceStatus { ready, missing, forbidden, notDir }

class WorkspaceSummary {
  const WorkspaceSummary({
    required this.path,
    required this.name,
    required this.status,
    required this.isDefault,
    this.entryCount,
    this.requestedPath,
  });

  final String path;
  final String name;
  final WorkspaceStatus status;
  final bool isDefault;
  final int? entryCount;
  final String? requestedPath;

  bool get isReady => status == WorkspaceStatus.ready;

  factory WorkspaceSummary.fromListPayload(Map<String, dynamic> payload) =>
      WorkspaceSummary(
        path: payload['path'] as String? ?? '',
        name: payload['name'] as String? ?? '',
        status: _workspaceStatusFromWire(payload['status'] as String?),
        isDefault: payload['is_default'] as bool? ?? false,
        entryCount: (payload['entry_count'] as num?)?.toInt(),
      );

  factory WorkspaceSummary.fromResolvePayload(Map<String, dynamic> payload) =>
      WorkspaceSummary(
        path: payload['resolved_path'] as String? ?? '',
        name: payload['name'] as String? ?? '',
        status: _workspaceStatusFromWire(payload['status'] as String?),
        isDefault: payload['is_default'] as bool? ?? false,
        entryCount: (payload['entry_count'] as num?)?.toInt(),
        requestedPath: payload['workspace_path'] as String?,
      );

  static List<WorkspaceSummary> listFromPayload(dynamic raw) {
    if (raw is! List) {
      return const <WorkspaceSummary>[];
    }
    return raw
        .whereType<Map>()
        .map(
          (item) => WorkspaceSummary.fromListPayload(
            item.map((key, value) => MapEntry('$key', value)),
          ),
        )
        .where((item) => item.path.isNotEmpty)
        .toList(growable: false);
  }
}

class WorkspaceCatalog {
  const WorkspaceCatalog({required this.items, this.defaultPath});

  final List<WorkspaceSummary> items;
  final String? defaultPath;

  static const empty = WorkspaceCatalog(items: <WorkspaceSummary>[]);
}

WorkspaceStatus _workspaceStatusFromWire(String? value) {
  return switch (value) {
    'missing' => WorkspaceStatus.missing,
    'forbidden' => WorkspaceStatus.forbidden,
    'not_dir' => WorkspaceStatus.notDir,
    _ => WorkspaceStatus.ready,
  };
}
