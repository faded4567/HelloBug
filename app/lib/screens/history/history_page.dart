import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/access_failure.dart';
import '../../models/inner_message.dart';
import '../../models/chat_item.dart';
import '../../state/devices_provider.dart';
import '../../state/sessions_provider.dart';
import '../../state/workspace_history_provider.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import '../../widgets/message_bubble.dart';
import '../../widgets/tool_use_card.dart';
import '../../widgets/thinking_card.dart';
import '../../widgets/diff_card.dart';
import '../new_session/new_session_flow.dart';
import 'claude_history_parser.dart';

// Lightweight summary received from history.list
class HistorySummary {
  final String sessionId;
  final String transcriptPath;
  final String workspacePath;
  final int messageCount;
  final DateTime createdAt;

  const HistorySummary({
    required this.sessionId,
    required this.transcriptPath,
    required this.workspacePath,
    required this.messageCount,
    required this.createdAt,
  });

  factory HistorySummary.fromJson(
    Map<String, dynamic> j, {
    required String workspacePath,
  }) => HistorySummary(
    sessionId: j['session_id'] as String,
    transcriptPath: j['path'] as String? ?? '',
    workspacePath: workspacePath,
    messageCount: (j['message_count'] as num?)?.toInt() ?? 0,
    createdAt: DateTime.fromMillisecondsSinceEpoch(
      (j['created_at'] as num?)?.toInt() ?? 0,
    ),
  );
}

class HistoryListPage extends ConsumerStatefulWidget {
  const HistoryListPage({super.key});

  @override
  ConsumerState<HistoryListPage> createState() => _HistoryListPageState();
}

class _HistoryListPageState extends ConsumerState<HistoryListPage> {
  final List<HistorySummary> _items = [];
  bool _loading = false;
  String? _workspacePath;
  AccessFailure? _error;
  String? _pendingRequestId;
  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<HistorySummary> get _filtered {
    if (_query.isEmpty) return _items;
    final q = _query.toLowerCase();
    return _items.where((i) =>
      i.sessionId.toLowerCase().contains(q) ||
      i.workspacePath.toLowerCase().contains(q)
    ).toList();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final client = ref.read(wsClientProvider);
    if (client == null) {
      setState(() {
        _loading = false;
        _error = const AccessFailure(message: '未连接到服务器');
      });
      return;
    }

    final workspacePath = await _resolveWorkspacePath();
    if (workspacePath == null || workspacePath.isEmpty) {
      if (mounted) {
        setState(() {
          _workspacePath = null;
          _items.clear();
          _loading = false;
        });
      }
      return;
    }

    final request = InnerMessage.create('history.list', {
      'workspace_path': workspacePath,
    });
    _pendingRequestId = request.id;
    final response = client.messages.firstWhere(
      (m) =>
          m.type == 'history.list' ||
          (m.type == 'error' && m.payload['request_id'] == _pendingRequestId),
    );
    await client.send(request);
    final msg = await response;
    if (msg.type == 'error') {
      if (mounted) {
        setState(() {
          _workspacePath = workspacePath;
          _items.clear();
          _loading = false;
          _error = resolveAccessFailure(
            surface: AccessFailureSurface.historyList,
            code: msg.payload['code'] as String? ?? '',
            fallback: msg.payload['message'] as String? ?? '历史记录读取失败',
          );
        });
      }
      return;
    }
    final list = _decodeObjectList(msg.payload['items']);
    if (mounted) {
      setState(() {
        _workspacePath = workspacePath;
        _error = null;
        _items
          ..clear()
          ..addAll(
            list.map(
              (item) =>
                  HistorySummary.fromJson(item, workspacePath: workspacePath),
            ),
          );
        _loading = false;
      });
    }
  }

  Future<String?> _resolveWorkspacePath() async {
    final history = await ref.read(workspaceHistoryProvider.future);
    if (history.currentPath != null && history.currentPath!.isNotEmpty) {
      return history.currentPath;
    }

    final sessions = ref.read(sessionsProvider);
    if (sessions.isNotEmpty && sessions.first.workspacePath.isNotEmpty) {
      return sessions.first.workspacePath;
    }

    if (history.recents.isNotEmpty) {
      return history.recents.first;
    }

    return null;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('历史记录', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: Column(
          children: [
            if (_items.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: CupertinoSearchTextField(
                  controller: _searchCtrl,
                  placeholder: '搜索会话 ID 或路径',
                  onChanged: (v) => setState(() => _query = v),
                  style: TextStyle(color: c.fg),
                ),
              ),
            Expanded(
              child:
                  _loading
                      ? const Center(child: CupertinoActivityIndicator())
                      : _error != null
                      ? Center(
                        child: _FailureView(
                          failure: _error!,
                          onPressed:
                              _error!.retryable
                                  ? _load
                                  : () => _closeHistorySurface(context),
                        ),
                      )
                      : _items.isEmpty
                      ? Center(
                        child: Text(
                          _workspacePath == null ? '暂无可用工作区' : '暂无历史记录',
                          style: TextStyle(color: c.fg2),
                        ),
                      )
                      : _filtered.isEmpty
                      ? Center(
                        child: Text('未找到匹配记录', style: TextStyle(color: c.fg2)),
                      )
                      : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _filtered.length,
                        itemBuilder: (ctx, i) => _HistoryTile(item: _filtered[i]),
                      ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.item});
  final HistorySummary item;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final name = item.workspacePath
        .split('/')
        .lastWhere((p) => p.isNotEmpty, orElse: () => item.workspacePath);
    final ts =
        '${item.createdAt.month}/${item.createdAt.day} ${item.createdAt.hour.toString().padLeft(2, '0')}:${item.createdAt.minute.toString().padLeft(2, '0')}';
    return GestureDetector(
      onTap:
          () => Navigator.of(context).push(
            CupertinoPageRoute(
              builder:
                  (_) => HistoryDetailPage(
                    sessionId: item.sessionId,
                    workspacePath: item.workspacePath,
                  ),
            ),
          ),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: c.bg2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: c.fg,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$ts · ${item.messageCount} 条消息',
                    style: TextStyle(fontSize: 13, color: c.fg2),
                  ),
                ],
              ),
            ),
            Icon(CupertinoIcons.chevron_right, size: 14, color: c.fg3),
          ],
        ),
      ),
    );
  }
}

class HistoryDetailPage extends ConsumerStatefulWidget {
  const HistoryDetailPage({
    super.key,
    required this.sessionId,
    required this.workspacePath,
  });
  final String sessionId;
  final String workspacePath;

  @override
  ConsumerState<HistoryDetailPage> createState() => _HistoryDetailPageState();
}

class _HistoryDetailPageState extends ConsumerState<HistoryDetailPage> {
  final List<ChatItem> _items = [];
  bool _loading = false;
  bool _continueBusy = false;
  int _offset = 0;
  int _total = 0;
  bool _hasMore = true;
  final _scroll = ScrollController();
  AccessFailure? _error;
  String? _pendingRequestId;

  @override
  void initState() {
    super.initState();
    _loadPage();
    _scroll.addListener(() {
      if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 100) {
        _loadPage();
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _loadPage() async {
    if (_loading || !_hasMore) return;
    setState(() => _loading = true);
    final client = ref.read(wsClientProvider);
    if (client != null) {
      final request = InnerMessage.create('history.get', {
        'session_id': widget.sessionId,
        'offset': _offset,
        'limit': 100,
      });
      _pendingRequestId = request.id;
      final response = client.messages.firstWhere(
        (m) =>
            (m.type == 'history.get' &&
                m.payload['session_id'] == widget.sessionId) ||
            (m.type == 'error' &&
                m.payload['request_id'] == _pendingRequestId &&
                (m.payload['session_id'] == widget.sessionId ||
                    m.payload['session_id'] == null)),
      );
      await client.send(request);
      final msg = await response;
      if (msg.type == 'error') {
        final failure = resolveAccessFailure(
          surface: AccessFailureSurface.historyDetail,
          code: msg.payload['code'] as String? ?? '',
          fallback: msg.payload['message'] as String? ?? '历史详情读取失败',
        );
        if (mounted) {
          setState(() {
            _loading = false;
            _error = failure;
            if (!failure.retryable) {
              _hasMore = false;
            }
          });
        }
        return;
      }
      final raw =
          (msg.payload['lines'] as List? ?? const [])
              .whereType<String>()
              .toList();
      final total = (msg.payload['total'] as num?)?.toInt() ?? raw.length;
      if (mounted) {
        setState(() {
          _items.addAll(parseClaudeHistoryLines(raw));
          _offset += raw.length;
          _total = total;
          _hasMore = _offset < _total;
          _loading = false;
          _error = null;
        });
      }
    } else {
      setState(() {
        _loading = false;
        _error = const AccessFailure(message: '未连接到服务器');
      });
    }
  }

  void _retryLoadPage() {
    if (_loading) {
      return;
    }
    _loadPage();
  }

  Future<void> _continueSession() async {
    if (_continueBusy) {
      return;
    }
    final onlineDevices = ref
        .read(devicesProvider)
        .values
        .where((device) => device.online)
        .toList(growable: false);
    if (onlineDevices.isEmpty) {
      await _showContinueError('当前没有在线电脑，先启动 daemon 再继续该历史会话');
      return;
    }

    setState(() => _continueBusy = true);
    try {
      unawaited(
        ref.read(workspaceHistoryProvider.notifier).visit(widget.workspacePath),
      );
      final preferredDeviceId =
          onlineDevices.length == 1 ? onlineDevices.first.deviceId : null;
      if (!mounted) {
        return;
      }
      await Navigator.of(context).push(
        CupertinoPageRoute(
          builder:
              (_) => NewSessionFlow(
                initialArgs: NewSessionFlowArgs(
                  preferredDeviceId: preferredDeviceId,
                  workspacePath: widget.workspacePath,
                  agentType: 'claude_code',
                  resumeSessionId: widget.sessionId,
                ),
              ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _continueBusy = false);
      }
    }
  }

  Future<void> _showContinueError(String message) {
    return showCupertinoDialog<void>(
      context: context,
      builder:
          (_) => CupertinoAlertDialog(
            title: const Text('无法继续'),
            content: Text(message),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('知道了'),
              ),
            ],
          ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final name = widget.workspacePath
        .split('/')
        .lastWhere((p) => p.isNotEmpty, orElse: () => widget.workspacePath);
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text(name, style: TextStyle(color: c.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: _continueBusy ? null : _continueSession,
          child:
              _continueBusy
                  ? CupertinoActivityIndicator(color: c.tint)
                  : Text('继续', style: TextStyle(color: c.tint)),
        ),
      ),
      child: SafeArea(
        child:
            _items.isEmpty && _loading
                ? const Center(child: CupertinoActivityIndicator())
                : _items.isEmpty && _error != null
                ? Center(
                  child: _FailureView(
                    failure: _error!,
                    onPressed:
                        _error!.retryable
                            ? _retryLoadPage
                            : () => _closeHistorySurface(context),
                  ),
                )
                : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  itemCount:
                      _items.length +
                      (_hasMore || _loading || _error != null ? 1 : 0),
                  itemBuilder: (ctx, i) {
                    if (i == _items.length) {
                      if (_loading) {
                        return const Center(
                          child: Padding(
                            padding: EdgeInsets.all(16),
                            child: CupertinoActivityIndicator(),
                          ),
                        );
                      }
                      if (_error != null) {
                        return Padding(
                          padding: const EdgeInsets.all(16),
                          child: _HistoryFooterFailure(
                            failure: _error!,
                            onPressed:
                                _error!.retryable
                                    ? _retryLoadPage
                                    : () => _closeHistorySurface(context),
                          ),
                        );
                      }
                      return const SizedBox.shrink();
                    }
                    return _HistoryItem(
                      item: _items[i],
                      isLast: i == _items.length - 1,
                      sessionId: widget.sessionId,
                      workspacePath: widget.workspacePath,
                    );
                  },
                ),
      ),
    );
  }
}

void _closeHistorySurface(BuildContext context) {
  if (context.canPop()) {
    context.pop();
    return;
  }
  context.go('/sessions');
}

class _FailureView extends StatelessWidget {
  const _FailureView({required this.failure, required this.onPressed});

  final AccessFailure failure;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            failure.message,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, color: context.colors.fg2),
          ),
          const SizedBox(height: 16),
          CupertinoButton(
            onPressed: onPressed,
            child: Text(
              failure.retryable ? '重试' : '返回',
              style: TextStyle(color: context.colors.tint),
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryFooterFailure extends StatelessWidget {
  const _HistoryFooterFailure({required this.failure, required this.onPressed});

  final AccessFailure failure;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(
            failure.message,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: c.fg2),
          ),
          const SizedBox(height: 8),
          CupertinoButton(
            padding: EdgeInsets.zero,
            onPressed: onPressed,
            child: Text(
              failure.retryable ? '重试加载' : '返回',
              style: TextStyle(color: c.tint),
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryItem extends StatelessWidget {
  const _HistoryItem({
    required this.item,
    required this.isLast,
    required this.sessionId,
    required this.workspacePath,
  });
  final ChatItem item;
  final bool isLast;
  final String sessionId;
  final String workspacePath;

  @override
  Widget build(BuildContext context) {
    return switch (item.kind) {
      ChatItemKind.user => MessageBubble(text: item.text ?? '', isUser: true),
      ChatItemKind.assistantDelta => MessageBubble(
        text: item.text ?? '',
        isUser: false,
      ),
      ChatItemKind.toolUse => Padding(
        padding: const EdgeInsets.only(left: 4),
        child: ToolUseCard(toolName: item.toolName ?? '', input: item.text),
      ),
      ChatItemKind.toolResult => Padding(
        padding: const EdgeInsets.only(left: 4),
        child: ToolResultCard(output: item.text ?? ''),
      ),
      ChatItemKind.thinking => Padding(
        padding: const EdgeInsets.only(left: 4),
        child: ThinkingCard(thinking: item.text ?? ''),
      ),
      ChatItemKind.fileChanged => Padding(
        padding: const EdgeInsets.only(left: 4),
        child: DiffCard(
          filePath: item.filePath ?? '',
          diff: item.diff ?? '',
          sessionId: sessionId,
          workspacePath: workspacePath,
        ),
      ),
      ChatItemKind.done => Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text(
            '— 会话结束 —',
            style: TextStyle(fontSize: 13, color: context.colors.fg3),
          ),
        ),
      ),
      ChatItemKind.usage => const SizedBox.shrink(),
    };
  }
}

List<Map<String, dynamic>> _decodeObjectList(Object? raw) {
  if (raw is! List) {
    return const [];
  }

  return raw
      .whereType<Map>()
      .map((item) => Map<String, dynamic>.from(item))
      .toList();
}
