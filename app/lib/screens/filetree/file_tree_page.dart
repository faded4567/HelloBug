import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/inner_message.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import 'file_tree_controller.dart';
import 'tree_node_tile.dart';
import 'file_preview_page.dart';

class FileTreePage extends ConsumerStatefulWidget {
  const FileTreePage({super.key, required this.sessionId, required this.workspacePath});
  final String sessionId;
  final String workspacePath;

  @override
  ConsumerState<FileTreePage> createState() => _FileTreePageState();
}

class _FileTreePageState extends ConsumerState<FileTreePage> {
  late final FileTreeController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = FileTreeController(
      onRequestChildren: (path) async {
        await ref.read(wsClientProvider)?.send(
          InnerMessage.create('fs.tree.req', {
            'session_id': widget.sessionId,
            'path': path,
          }),
        );
      },
    );
    // Listen for fs.tree responses
    ref.listenManual(wsClientProvider, (_, client) {
      client?.messages.listen((msg) {
        if (msg.type == 'fs.tree') _ctrl.applyResponse(msg.payload);
      });
    });
    _ctrl.loadRoot(widget.workspacePath);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final wsName = widget.workspacePath.split('/').lastWhere((p) => p.isNotEmpty, orElse: () => widget.workspacePath);
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
            if (_ctrl.root == null) return const Center(child: CupertinoActivityIndicator());
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
                      Navigator.of(context).push(CupertinoPageRoute(
                        builder: (_) => FilePreviewPage(
                          sessionId: widget.sessionId,
                          filePath: node.path,
                        ),
                      ));
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
