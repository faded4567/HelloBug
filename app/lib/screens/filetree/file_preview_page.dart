import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/inner_message.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';

class FilePreviewPage extends ConsumerStatefulWidget {
  const FilePreviewPage({super.key, required this.sessionId, required this.filePath});
  final String sessionId;
  final String filePath;

  @override
  ConsumerState<FilePreviewPage> createState() => _FilePreviewPageState();
}

class _FilePreviewPageState extends ConsumerState<FilePreviewPage> {
  final _chunks = <int, String>{};
  int? _totalChunks;
  bool _loading = true;
  StreamSubscription? _sub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _request());
  }

  void _request() {
    final client = ref.read(wsClientProvider);
    _sub = client?.messages.listen((msg) {
      if (msg.type != 'fs.file') return;
      final p = msg.payload;
      if (p['file_path'] != widget.filePath) return;
      final idx = (p['chunk_index'] as int?) ?? 0;
      final total = (p['total_chunks'] as int?) ?? 1;
      _chunks[idx] = p['content'] as String? ?? '';
      if (mounted) setState(() { _totalChunks = total; });
      if (_chunks.length == total && mounted) setState(() => _loading = false);
    });
    client?.send(InnerMessage.create('fs.read', {
      'session_id': widget.sessionId,
      'file_path': widget.filePath,
    }));
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  String get _content {
    if (_totalChunks == null) return '';
    return List.generate(_totalChunks!, (i) => _chunks[i] ?? '').join();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final fileName = widget.filePath.split('/').last;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text(fileName, style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: _loading
            ? const Center(child: CupertinoActivityIndicator())
            : SingleChildScrollView(
                padding: const EdgeInsets.all(12),
                child: Text(
                  _content,
                  style: TextStyle(fontSize: 12, fontFamily: 'Menlo', color: c.fg, height: 1.5),
                ),
              ),
      ),
    );
  }
}
