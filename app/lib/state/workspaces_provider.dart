import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/inner_message.dart';
import '../models/workspace_summary.dart';
import '../transport/ws_client.dart';
import '../transport/ws_provider.dart';

final workspacesProvider =
    AsyncNotifierProvider<WorkspacesNotifier, WorkspaceCatalog>(
      WorkspacesNotifier.new,
    );

class WorkspacesNotifier extends AsyncNotifier<WorkspaceCatalog> {
  @override
  Future<WorkspaceCatalog> build() async {
    final client = ref.watch(wsClientProvider);
    if (client == null) {
      return WorkspaceCatalog.empty;
    }
    return _fetchCatalog(client);
  }

  Future<void> refresh() async {
    final client = ref.read(wsClientProvider);
    if (client == null) {
      state = const AsyncData(WorkspaceCatalog.empty);
      return;
    }
    state = const AsyncLoading<WorkspaceCatalog>();
    state = await AsyncValue.guard(() => _fetchCatalog(client));
  }

  Future<WorkspaceSummary> resolveWorkspace(String workspacePath) async {
    final client = ref.read(wsClientProvider);
    if (client == null) {
      throw StateError('未连接到服务器');
    }

    final request = InnerMessage.create('workspace.resolve', {
      'workspace_path': workspacePath,
    });
    final response = client.messages
        .firstWhere(
          (message) =>
              (message.type == 'workspace.resolve' &&
                  message.id == request.id) ||
              (message.type == 'error' &&
                  message.payload['request_id'] == request.id),
        )
        .timeout(const Duration(seconds: 5));
    await client.send(request);
    final msg = await response;
    if (msg.type == 'error') {
      throw StateError(msg.payload['message'] as String? ?? '工作区校验失败');
    }

    final resolved = WorkspaceSummary.fromResolvePayload(msg.payload);
    _mergeResolvedWorkspace(resolved);
    return resolved;
  }

  Future<WorkspaceCatalog> _fetchCatalog(WsClient client) async {
    final request = InnerMessage.create('workspace.list', const {});
    final response = client.messages
        .firstWhere(
          (message) =>
              (message.type == 'workspace.list' && message.id == request.id) ||
              (message.type == 'error' &&
                  message.payload['request_id'] == request.id),
        )
        .timeout(const Duration(seconds: 5));
    await client.send(request);
    final msg = await response;
    if (msg.type == 'error') {
      throw StateError(msg.payload['message'] as String? ?? '工作区列表读取失败');
    }

    return WorkspaceCatalog(
      defaultPath: msg.payload['default_path'] as String?,
      items: WorkspaceSummary.listFromPayload(msg.payload['items']),
    );
  }

  void _mergeResolvedWorkspace(WorkspaceSummary resolved) {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }

    final items = [...current.items];
    final index = items.indexWhere((item) => item.path == resolved.path);
    if (index >= 0) {
      items[index] = resolved;
    } else {
      items.insert(0, resolved);
    }
    state = AsyncData(
      WorkspaceCatalog(
        defaultPath:
            current.defaultPath ?? (resolved.isDefault ? resolved.path : null),
        items: items,
      ),
    );
  }
}
