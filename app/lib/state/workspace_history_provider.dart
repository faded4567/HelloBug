import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _kKey = 'workspace_history_v1';
const _kMaxRecent = 10;

class WorkspaceHistory {
  final List<String> recents;
  final Set<String> pinned;
  final String? currentPath;
  const WorkspaceHistory({
    required this.recents,
    required this.pinned,
    this.currentPath,
  });
  static const empty = WorkspaceHistory(
    recents: [],
    pinned: {},
    currentPath: null,
  );
}

class WorkspaceHistoryNotifier extends AsyncNotifier<WorkspaceHistory> {
  final _store = const FlutterSecureStorage();

  @override
  Future<WorkspaceHistory> build() => _load();

  Future<WorkspaceHistory> _load() async {
    final raw = await _store.read(key: _kKey);
    if (raw == null) return WorkspaceHistory.empty;
    final j = jsonDecode(raw) as Map<String, dynamic>;
    final currentPath = (j['current'] as String?)?.trim();
    return WorkspaceHistory(
      recents: List<String>.from(j['recents'] as List? ?? []),
      pinned: Set<String>.from(j['pinned'] as List? ?? []),
      currentPath:
          currentPath == null || currentPath.isEmpty ? null : currentPath,
    );
  }

  Future<void> _save(WorkspaceHistory h) async {
    await _store.write(
      key: _kKey,
      value: jsonEncode({
        'recents': h.recents,
        'pinned': h.pinned.toList(),
        'current': h.currentPath,
      }),
    );
    state = AsyncData(h);
  }

  Future<void> visit(String path) async {
    final normalized = path.trim();
    if (normalized.isEmpty) {
      return;
    }
    final h = state.valueOrNull ?? WorkspaceHistory.empty;
    final recents = [normalized, ...h.recents.where((p) => p != normalized)];
    await _save(
      WorkspaceHistory(
        recents: recents.take(_kMaxRecent).toList(),
        pinned: h.pinned,
        currentPath: normalized,
      ),
    );
  }

  Future<void> togglePin(String path) async {
    final h = state.valueOrNull ?? WorkspaceHistory.empty;
    final pinned = Set<String>.from(h.pinned);
    if (pinned.contains(path)) {
      pinned.remove(path);
    } else {
      pinned.add(path);
    }
    await _save(
      WorkspaceHistory(
        recents: h.recents,
        pinned: pinned,
        currentPath: h.currentPath,
      ),
    );
  }
}

final workspaceHistoryProvider =
    AsyncNotifierProvider<WorkspaceHistoryNotifier, WorkspaceHistory>(
      WorkspaceHistoryNotifier.new,
    );
