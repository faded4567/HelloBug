import 'dart:async';
import 'dart:convert';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/inner_message.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';

class FilePreviewPage extends ConsumerStatefulWidget {
  const FilePreviewPage({
    super.key,
    required this.sessionId,
    required this.filePath,
  });
  final String sessionId;
  final String filePath;

  @override
  ConsumerState<FilePreviewPage> createState() => _FilePreviewPageState();
}

class _FilePreviewPageState extends ConsumerState<FilePreviewPage> {
  final _chunks = <int, String>{};
  int? _totalChunks;
  bool _loading = true;
  String? _error;
  StreamSubscription? _sub;
  String? _requestId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _request());
  }

  void _request() {
    final client = ref.read(wsClientProvider);
    if (client == null) {
      setState(() {
        _loading = false;
        _error = '未连接';
      });
      return;
    }
    _sub?.cancel();
    final request = InnerMessage.create('fs.file.req', {
      'session_id': widget.sessionId,
      'file_path': widget.filePath,
    });
    _requestId = request.id;
    debugPrint(
      '[FilePreview] request session=${widget.sessionId} file=${widget.filePath} request_id=$_requestId',
    );
    _sub = client.messages.listen((msg) {
      if (msg.type == 'error') {
        if (msg.payload['request_id'] != _requestId) return;
        if (mounted) {
          setState(() {
            _loading = false;
            _error = msg.payload['message'] as String? ?? '读取失败';
          });
        }
        debugPrint(
          '[FilePreview] error request_id=$_requestId message=$_error',
        );
        return;
      }
      if (msg.type != 'fs.file') return;
      if (msg.payload['file_path'] != widget.filePath) return;
      final p = msg.payload;
      final idx = (p['chunk_index'] as int?) ?? 0;
      final total = (p['total_chunks'] as int?) ?? 1;
      debugPrint(
        '[FilePreview] chunk file=${widget.filePath} chunk=${idx + 1}/$total',
      );
      try {
        _chunks[idx] = _decodeChunkPayload(p);
      } catch (_) {
        if (mounted) {
          setState(() {
            _loading = false;
            _error = '不支持的文件格式';
          });
        }
        debugPrint('[FilePreview] decode failed file=${widget.filePath}');
        return;
      }
      if (mounted) {
        setState(() {
          _totalChunks = total;
        });
      }
      if (_chunks.length == total && mounted) {
        setState(() => _loading = false);
        debugPrint(
          '[FilePreview] completed file=${widget.filePath} total_chunks=$total',
        );
      }
    });
    unawaited(client.send(request));
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  String _decodeBase64Url(String s) {
    if (s.isEmpty) return '';
    final padded = s.padRight((s.length + 3) ~/ 4 * 4, '=');
    return utf8.decode(base64Url.decode(padded));
  }

  String _decodeChunkPayload(Map<String, dynamic> payload) {
    final encoded =
        payload['data_base64url'] as String? ??
        payload['data'] as String? ??
        '';
    return _decodeBase64Url(encoded);
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
        child:
            _error != null
                ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('⚠️', style: const TextStyle(fontSize: 36)),
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        style: TextStyle(fontSize: 15, color: c.fg2),
                      ),
                      const SizedBox(height: 16),
                      CupertinoButton(
                        onPressed: () {
                          setState(() {
                            _loading = true;
                            _error = null;
                            _chunks.clear();
                          });
                          _request();
                        },
                        child: Text('重试', style: TextStyle(color: c.tint)),
                      ),
                    ],
                  ),
                )
                : _loading
                ? const Center(child: CupertinoActivityIndicator())
                : _content.isEmpty
                ? Center(
                  child: Text(
                    '空文件',
                    style: TextStyle(fontSize: 15, color: c.fg3),
                  ),
                )
                : SingleChildScrollView(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    _content,
                    style: TextStyle(
                      fontSize: 12,
                      fontFamily: 'Menlo',
                      color: c.fg,
                      height: 1.5,
                    ),
                  ),
                ),
      ),
    );
  }
}
