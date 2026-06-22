import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/inner_message.dart';
import '../../models/chat_item.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import '../../widgets/message_bubble.dart';
import '../../widgets/tool_use_card.dart';
import '../../widgets/thinking_card.dart';
import '../../widgets/diff_card.dart';

// Lightweight summary received from history.list
class HistorySummary {
  final String sessionId;
  final String workspacePath;
  final int messageCount;
  final DateTime createdAt;

  const HistorySummary({
    required this.sessionId,
    required this.workspacePath,
    required this.messageCount,
    required this.createdAt,
  });

  factory HistorySummary.fromJson(Map<String, dynamic> j) => HistorySummary(
    sessionId: j['session_id'] as String,
    workspacePath: j['workspace_path'] as String? ?? '~',
    messageCount: (j['message_count'] as num?)?.toInt() ?? 0,
    createdAt: DateTime.fromMillisecondsSinceEpoch((j['created_at'] as num?)?.toInt() ?? 0),
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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final client = ref.read(wsClientProvider);
    if (client != null) {
      await client.send(InnerMessage.create('history.list', {}));
      final sub = client.messages.firstWhere((m) => m.type == 'history.list');
      final msg = await sub;
      final list = (msg.payload['items'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      if (mounted) {
        setState(() {
          _items
            ..clear()
            ..addAll(list.map(HistorySummary.fromJson));
          _loading = false;
        });
      }
    } else {
      setState(() => _loading = false);
    }
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
        child: _loading
            ? const Center(child: CupertinoActivityIndicator())
            : _items.isEmpty
                ? Center(child: Text('暂无历史记录', style: TextStyle(color: c.fg2)))
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length,
                    itemBuilder: (ctx, i) => _HistoryTile(item: _items[i]),
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
    final name = item.workspacePath.split('/').lastWhere((p) => p.isNotEmpty, orElse: () => item.workspacePath);
    final ts = '${item.createdAt.month}/${item.createdAt.day} ${item.createdAt.hour.toString().padLeft(2, '0')}:${item.createdAt.minute.toString().padLeft(2, '0')}';
    return GestureDetector(
      onTap: () => Navigator.of(context).push(CupertinoPageRoute(
        builder: (_) => HistoryDetailPage(sessionId: item.sessionId, workspacePath: item.workspacePath),
      )),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.fg)),
            const SizedBox(height: 2),
            Text('$ts · ${item.messageCount} 条消息', style: TextStyle(fontSize: 13, color: c.fg2)),
          ])),
          Icon(CupertinoIcons.chevron_right, size: 14, color: c.fg3),
        ]),
      ),
    );
  }
}

class HistoryDetailPage extends ConsumerStatefulWidget {
  const HistoryDetailPage({super.key, required this.sessionId, required this.workspacePath});
  final String sessionId;
  final String workspacePath;

  @override
  ConsumerState<HistoryDetailPage> createState() => _HistoryDetailPageState();
}

class _HistoryDetailPageState extends ConsumerState<HistoryDetailPage> {
  final List<ChatItem> _items = [];
  bool _loading = false;
  int _page = 0;
  bool _hasMore = true;
  final _scroll = ScrollController();

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
      await client.send(InnerMessage.create('history.get', {
        'session_id': widget.sessionId,
        'offset': _page * 100,
        'limit': 100,
      }));
      final msg = await client.messages.firstWhere((m) =>
        m.type == 'history.get' && m.payload['session_id'] == widget.sessionId);
      final raw = (msg.payload['items'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      if (mounted) {
        setState(() {
          _items.addAll(_parseItems(raw));
          _hasMore = raw.length == 100;
          _page++;
          _loading = false;
        });
      }
    } else {
      setState(() => _loading = false);
    }
  }

  List<ChatItem> _parseItems(List<Map<String, dynamic>> raw) {
    return raw.map((j) {
      final kind = switch (j['type'] as String? ?? '') {
        'user'             => ChatItemKind.user,
        'assistant.delta'  => ChatItemKind.assistantDelta,
        'tool.use'         => ChatItemKind.toolUse,
        'tool.result'      => ChatItemKind.toolResult,
        'thinking'         => ChatItemKind.thinking,
        'file.changed'     => ChatItemKind.fileChanged,
        _                  => ChatItemKind.done,
      };
      return ChatItem(
        id: j['id'] as String? ?? '',
        kind: kind,
        text: j['text'] as String?,
        toolName: j['tool_name'] as String?,
        filePath: j['file_path'] as String?,
        diff: j['diff'] as String?,
      );
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final name = widget.workspacePath.split('/').lastWhere((p) => p.isNotEmpty, orElse: () => widget.workspacePath);
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text(name, style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: _items.isEmpty && _loading
            ? const Center(child: CupertinoActivityIndicator())
            : ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                itemCount: _items.length + (_hasMore ? 1 : 0),
                itemBuilder: (ctx, i) {
                  if (i == _items.length) return const Center(child: Padding(padding: EdgeInsets.all(16), child: CupertinoActivityIndicator()));
                  return _HistoryItem(item: _items[i], isLast: i == _items.length - 1);
                },
              ),
      ),
    );
  }
}

class _HistoryItem extends StatelessWidget {
  const _HistoryItem({required this.item, required this.isLast});
  final ChatItem item;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return switch (item.kind) {
      ChatItemKind.user           => MessageBubble(text: item.text ?? '', isUser: true),
      ChatItemKind.assistantDelta => MessageBubble(text: item.text ?? '', isUser: false),
      ChatItemKind.toolUse        => Padding(padding: const EdgeInsets.only(left: 4), child: ToolUseCard(toolName: item.toolName ?? '', input: item.text)),
      ChatItemKind.toolResult     => Padding(padding: const EdgeInsets.only(left: 4), child: ToolResultCard(output: item.text ?? '')),
      ChatItemKind.thinking       => Padding(padding: const EdgeInsets.only(left: 4), child: ThinkingCard(thinking: item.text ?? '')),
      ChatItemKind.fileChanged    => Padding(padding: const EdgeInsets.only(left: 4), child: DiffCard(filePath: item.filePath ?? '', diff: item.diff ?? '')),
      ChatItemKind.done           => Center(child: Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text('— 会话结束 —', style: TextStyle(fontSize: 13, color: context.colors.fg3)))),
    };
  }
}
