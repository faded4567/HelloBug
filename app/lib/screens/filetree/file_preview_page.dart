import 'dart:async';
import 'dart:convert';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/access_failure.dart';
import '../../models/inner_message.dart';
import '../../state/workspace_history_provider.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';

class FilePreviewPage extends ConsumerStatefulWidget {
  const FilePreviewPage({
    super.key,
    required this.sessionId,
    required this.filePath,
    this.workspacePath,
  });
  final String sessionId;
  final String filePath;
  final String? workspacePath;

  @override
  ConsumerState<FilePreviewPage> createState() => _FilePreviewPageState();
}

class _FilePreviewPageState extends ConsumerState<FilePreviewPage> {
  final _chunks = <int, String>{};
  int? _totalChunks;
  bool _loading = true;
  AccessFailure? _error;
  StreamSubscription? _sub;
  String? _requestId;

  @override
  void initState() {
    super.initState();
    final workspacePath = widget.workspacePath?.trim();
    if (workspacePath != null && workspacePath.isNotEmpty) {
      unawaited(
        ref.read(workspaceHistoryProvider.notifier).visit(workspacePath),
      );
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _request());
  }

  void _request() {
    final client = ref.read(wsClientProvider);
    if (client == null) {
      setState(() {
        _loading = false;
        _error = const AccessFailure(message: '未连接');
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
        final code = msg.payload['code'] as String? ?? '';
        if (mounted) {
          setState(() {
            _loading = false;
            _error = resolveAccessFailure(
              surface: AccessFailureSurface.filePreview,
              code: code,
              fallback: msg.payload['message'] as String? ?? '读取失败',
            );
          });
        }
        debugPrint(
          '[FilePreview] error request_id=$_requestId code=$code message=${_error?.message}',
        );
        return;
      }
      if (msg.type != 'fs.file') return;
      if (msg.payload['session_id'] != widget.sessionId) return;
      if (msg.payload['file_path'] != widget.filePath) return;
      final p = msg.payload;
      final status = (p['status'] as String?) ?? 'ready';
      if (status != 'ready') {
        if (mounted) {
          setState(() {
            _loading = false;
            _chunks.clear();
            _totalChunks = null;
            _error = _resolvePreviewState(p, status);
          });
        }
        debugPrint(
          '[FilePreview] state file=${widget.filePath} status=$status message=${_error?.message}',
        );
        return;
      }
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
            _chunks.clear();
            _totalChunks = null;
            _error = const AccessFailure(message: '不支持的文件格式', retryable: false);
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
    final encoded = payload['data'] as String? ?? '';
    return _decodeBase64Url(encoded);
  }

  AccessFailure _resolvePreviewState(
    Map<String, dynamic> payload,
    String status,
  ) {
    final fallback = payload['message'] as String? ?? '读取文件失败';
    switch (status) {
      case 'binary':
        return AccessFailure(
          message: '二进制文件暂不支持文本预览',
          retryable: false,
        );
      case 'too_large':
        final totalSize = (payload['total_size'] as num?)?.toInt();
        final maxPreviewSize = (payload['max_preview_size'] as num?)?.toInt();
        return AccessFailure(
          message: _buildTooLargeMessage(totalSize, maxPreviewSize),
          retryable: false,
        );
      case 'permission_denied':
        return resolveAccessFailure(
          surface: AccessFailureSurface.filePreview,
          code: 'WORKSPACE_FORBIDDEN',
          fallback: fallback,
        );
      case 'not_found':
        return resolveAccessFailure(
          surface: AccessFailureSurface.filePreview,
          code: 'FILE_NOT_FOUND',
          fallback: fallback,
        );
      default:
        return AccessFailure(message: fallback);
    }
  }

  String _buildTooLargeMessage(int? totalSize, int? maxPreviewSize) {
    final sizeLabel = totalSize == null ? null : _formatBytes(totalSize);
    final limitLabel =
        maxPreviewSize == null ? null : _formatBytes(maxPreviewSize);
    if (sizeLabel != null && limitLabel != null) {
      return '文件过大，暂不支持文本预览（$sizeLabel，当前上限 $limitLabel）';
    }
    return '文件过大，暂不支持文本预览';
  }

  String _formatBytes(int bytes) {
    const kb = 1024;
    const mb = kb * 1024;
    if (bytes >= mb) {
      return '${(bytes / mb).toStringAsFixed(bytes % mb == 0 ? 0 : 1)} MB';
    }
    if (bytes >= kb) {
      return '${(bytes / kb).toStringAsFixed(bytes % kb == 0 ? 0 : 1)} KB';
    }
    return '$bytes B';
  }

  String get _content {
    if (_totalChunks == null) return '';
    return List.generate(_totalChunks!, (i) => _chunks[i] ?? '').join();
  }

  void _retry() {
    setState(() {
      _loading = true;
      _error = null;
      _totalChunks = null;
      _chunks.clear();
    });
    _request();
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
                        _error!.message,
                        style: TextStyle(fontSize: 15, color: c.fg2),
                      ),
                      const SizedBox(height: 16),
                      CupertinoButton(
                        onPressed:
                            _error!.retryable
                                ? _retry
                                : () => Navigator.of(context).maybePop(),
                        child: Text(
                          _error!.retryable ? '重试' : '返回',
                          style: TextStyle(color: c.tint),
                        ),
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
