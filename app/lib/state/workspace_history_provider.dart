import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _kKey = 'workspace_history_v1';
const _kMaxRecent = 10;

class WorkspaceHistory {
  final List<String> recents;
  final Set<String> pinned;
  const WorkspaceHistory({required this.recents, required this.pinned});
  static const empty = WorkspaceHistory(recents: [], pinned: {});
}

class WorkspaceHistoryNotifier extends AsyncNotifier<WorkspaceHistory> {
  final _store = const FlutterSecureStorage();

  @override
  Future<WorkspaceHistory> build() => _load();

  Future<WorkspaceHistory> _load() async {
    final raw = await _store.read(key: _kKey);
    if (raw == null) return WorkspaceHistory.empty;
    final j = jsonDecode(raw) as Map<String, dynamic>;
    return WorkspaceHistory(
      recents: List<String>.from(j['recents'] as List? ?? []),
      pinned: Set<String>.from(j['pinned'] as List? ?? []),
    );
  }

  Future<void> _save(WorkspaceHistory h) async {
    await _store.write(
      key: _kKey,
      value: jsonEncode({'recents': h.recents, 'pinned': h.pinned.toList()}),
    );
    state = AsyncData(h);
  }

  Future<void> visit(String path) async {
    final h = state.valueOrNull ?? WorkspaceHistory.empty;
    final recents = [path, ...h.recents.where((p) => p != path)];
    await _save(WorkspaceHistory(
      recents: recents.take(_kMaxRecent).toList(),
      pinned: h.pinned,
    ));
  }

  Future<void> togglePin(String path) async {
    final h = state.valueOrNull ?? WorkspaceHistory.empty;
    final pinned = Set<String>.from(h.pinned);
    if (pinned.contains(path)) { pinned.remove(path); } else { pinned.add(path); }
    await _save(WorkspaceHistory(recents: h.recents, pinned: pinned));
  }
}

final workspaceHistoryProvider =
    AsyncNotifierProvider<WorkspaceHistoryNotifier, WorkspaceHistory>(
        WorkspaceHistoryNotifier.new);
