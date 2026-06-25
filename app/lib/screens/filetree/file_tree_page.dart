import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/access_failure.dart';
import '../../models/inner_message.dart';
import '../../state/workspace_history_provider.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import 'file_tree_controller.dart';
import 'tree_node_tile.dart';
import 'file_preview_page.dart';

class FileTreePage extends ConsumerStatefulWidget {
  const FileTreePage({
    super.key,
    required this.sessionId,
    required this.workspacePath,
  });
  final String sessionId;
  final String workspacePath;

  @override
  ConsumerState<FileTreePage> createState() => _FileTreePageState();
}

class _FileTreePageState extends ConsumerState<FileTreePage> {
  late final FileTreeController _ctrl;
  StreamSubscription<InnerMessage>? _messagesSub;
  AccessFailure? _error;
  final Set<String> _pendingRequestIds = <String>{};

  @override
  void initState() {
    super.initState();
    unawaited(
      ref.read(workspaceHistoryProvider.notifier).visit(widget.workspacePath),
    );
    _ctrl = FileTreeController(
      onRequestChildren: (absPath) async {
        final dirPath =
            absPath == widget.workspacePath
                ? ''
                : absPath.substring(widget.workspacePath.length + 1);
        debugPrint(
          '[FileTree] request session=${widget.sessionId} workspace=${widget.workspacePath} dir=${dirPath.isEmpty ? "." : dirPath}',
        );
        final request = InnerMessage.create('fs.tree.req', {
          'session_id': widget.sessionId,
          'workspace_path': widget.workspacePath,
          'dir_path': dirPath,
        });
        _pendingRequestIds.add(request.id);
        await ref.read(wsClientProvider)?.send(request);
      },
    );
    final client = ref.read(wsClientProvider);
    _messagesSub = client?.messages.listen((msg) {
      if (msg.type == 'error') {
        final requestId = msg.payload['request_id'] as String? ?? '';
        if (!_pendingRequestIds.remove(requestId)) return;
        final sessionId = msg.payload['session_id'] as String? ?? '';
        if (sessionId.isNotEmpty && sessionId != widget.sessionId) return;
        final code = msg.payload['code'] as String? ?? '';
        if (mounted) {
          setState(() {
            _error = resolveAccessFailure(
              surface: AccessFailureSurface.fileTree,
              code: code,
              fallback: msg.payload['message'] as String? ?? '读取目录失败',
            );
          });
        }
        return;
      }
      if (msg.type != 'fs.tree') return;
      if (msg.payload['session_id'] != widget.sessionId) return;
      if (msg.payload['workspace_path'] != widget.workspacePath) return;
      final dirPath = msg.payload['dir_path'] as String? ?? '';
      final entries = (msg.payload['entries'] as List?)?.length ?? 0;
      debugPrint(
        '[FileTree] response session=${widget.sessionId} dir=${dirPath.isEmpty ? "." : dirPath} entries=$entries',
      );
      if (mounted && _error != null) {
        setState(() {
          _error = null;
        });
      }
      _pendingRequestIds.clear();
      _ctrl.applyResponse(msg.payload);
    });
    _ctrl.loadRoot(widget.workspacePath);
  }

  @override
  void dispose() {
    _messagesSub?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  void _reloadRoot() {
    _pendingRequestIds.clear();
    setState(() {
      _error = null;
    });
    _ctrl.loadRoot(widget.workspacePath);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final wsName = widget.workspacePath
        .split('/')
        .lastWhere((p) => p.isNotEmpty, orElse: () => widget.workspacePath);
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text(wsName, style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListenableBuilder(
          listenable: _ctrl,
          builder: (ctx, _) {
            if (_error != null) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _error!.message,
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 15, color: c.fg2),
                      ),
                      const SizedBox(height: 16),
                      CupertinoButton(
                        onPressed:
                            _error!.retryable
                                ? _reloadRoot
                                : () => Navigator.of(context).maybePop(),
                        child: Text(
                          _error!.retryable ? '重试' : '返回',
                          style: TextStyle(color: c.tint),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }
            if (_ctrl.root == null) {
              return const Center(child: CupertinoActivityIndicator());
            }
            return ListView.builder(
              itemCount: _ctrl.flatList.length,
              itemBuilder: (ctx, i) {
                final entry = _ctrl.flatList[i];
                final node = entry.node;
                return TreeNodeTile(
                  entry: entry,
                  onTap: () {
                    if (node.isDir) {
                      _ctrl.toggle(node);
                    } else {
                      Navigator.of(context).push(
                        CupertinoPageRoute(
                          builder:
                              (_) => FilePreviewPage(
                                sessionId: widget.sessionId,
                                workspacePath: widget.workspacePath,
                                filePath: node.path,
                              ),
                        ),
                      );
                    }
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }
}
