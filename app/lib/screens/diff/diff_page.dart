import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../diff/diff_parser.dart';
import '../../diff/unified_diff_view.dart';
import '../../models/session_summary.dart';
import '../../state/sessions_provider.dart';
import '../../state/workspace_history_provider.dart';
import '../../theme/index.dart';
import '../filetree/file_preview_page.dart';

class DiffPageArgs {
  final String filePath;
  final String diff;
  final String? sessionId;
  final String? workspacePath;

  const DiffPageArgs({
    required this.filePath,
    required this.diff,
    this.sessionId,
    this.workspacePath,
  });
}

class DiffPage extends ConsumerStatefulWidget {
  const DiffPage({super.key, required this.args});

  final DiffPageArgs args;

  @override
  ConsumerState<DiffPage> createState() => _DiffPageState();
}

class _DiffPageState extends ConsumerState<DiffPage> {
  late final List<DiffHunk> _hunks;
  late final List<int> _hunkOffsets;
  final _scroll = ScrollController();
  bool _splitMode = false;
  int _hunkIdx = 0;

  @override
  void initState() {
    super.initState();
    _hunks = parseDiff(widget.args.diff);
    _hunkOffsets = hunkHeaderIndices(_hunks);
    _scroll.addListener(_syncHunkIndex);
    final workspacePath = widget.args.workspacePath?.trim();
    if (workspacePath != null && workspacePath.isNotEmpty) {
      unawaited(
        ref.read(workspaceHistoryProvider.notifier).visit(workspacePath),
      );
    }
  }

  @override
  void dispose() {
    _scroll.removeListener(_syncHunkIndex);
    _scroll.dispose();
    super.dispose();
  }

  void _jump(int index) {
    if (index < 0 || index >= _hunks.length) {
      return;
    }
    setState(() => _hunkIdx = index);
    _scroll.jumpTo(_hunkOffsets[index] * _lineH);
  }

  void _setSplitMode(bool splitMode) {
    setState(() {
      _splitMode = splitMode;
      _hunkIdx = 0;
    });
    if (_scroll.hasClients) {
      _scroll.jumpTo(0);
    }
  }

  void _syncHunkIndex() {
    if (_hunkOffsets.isEmpty) {
      return;
    }
    final currentLine = (_scroll.hasClients ? _scroll.offset : 0) / _lineH;
    var nextIndex = 0;
    for (var i = 0; i < _hunkOffsets.length; i++) {
      if (_hunkOffsets[i] <= currentLine) {
        nextIndex = i;
      } else {
        break;
      }
    }
    if (nextIndex != _hunkIdx && mounted) {
      setState(() => _hunkIdx = nextIndex);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final fileName = widget.args.filePath.split('/').last;
    final activeSession = _resolvePreviewSession(ref.watch(sessionsProvider));

    var added = 0;
    var removed = 0;
    for (final hunk in _hunks) {
      for (final line in hunk.lines) {
        if (line.type == DiffLineType.added) {
          added++;
        }
        if (line.type == DiffLineType.removed) {
          removed++;
        }
      }
    }

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text(
          fileName,
          style: TextStyle(fontSize: 14, fontFamily: 'Menlo', color: c.fg),
        ),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: c.separator)),
            ),
            child: Row(
              children: [
                Container(
                  decoration: BoxDecoration(
                    color: c.bg3,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  padding: const EdgeInsets.all(2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _DiffModeButton(
                        label: '统一',
                        active: !_splitMode,
                        onPressed:
                            _splitMode ? () => _setSplitMode(false) : null,
                      ),
                      _DiffModeButton(
                        label: '分栏',
                        active: _splitMode,
                        onPressed:
                            !_splitMode ? () => _setSplitMode(true) : null,
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                if (added > 0)
                  const Padding(
                    padding: EdgeInsets.only(right: 8),
                    child: SizedBox.shrink(),
                  ),
                if (added > 0)
                  Text(
                    '+$added',
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.addFg,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                if (added > 0 && removed > 0) const SizedBox(width: 8),
                if (removed > 0)
                  Text(
                    '-$removed',
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.delFg,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                if (activeSession != null) ...[
                  const SizedBox(width: 8),
                  CupertinoButton(
                    padding: EdgeInsets.zero,
                    minimumSize: Size.zero,
                    onPressed: () => _openFilePreview(context, activeSession),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: c.tintBg,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '对应文件',
                        style: TextStyle(fontSize: 13, color: c.tint),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          Expanded(
            child:
                _splitMode
                    ? SplitDiffView(hunks: _hunks, scrollController: _scroll)
                    : UnifiedDiffView(hunks: _hunks, scrollController: _scroll),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: c.separator)),
            ),
            child: Row(
              children: [
                _DiffNavButton(
                  label: '◀ 上一处',
                  enabled: _hunkIdx > 0,
                  onPressed: _hunkIdx > 0 ? () => _jump(_hunkIdx - 1) : null,
                ),
                Expanded(
                  child: Center(
                    child: Text(
                      '${_hunkIdx + 1} / ${_hunks.length} 处变更',
                      style: TextStyle(fontSize: 13, color: c.fg2),
                    ),
                  ),
                ),
                _DiffNavButton(
                  label: '下一处 ▶',
                  enabled: _hunkIdx < _hunks.length - 1,
                  onPressed:
                      _hunkIdx < _hunks.length - 1
                          ? () => _jump(_hunkIdx + 1)
                          : null,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  SessionSummary? _resolvePreviewSession(List<SessionSummary> sessions) {
    final sessionId = widget.args.sessionId?.trim();
    if (sessionId == null || sessionId.isEmpty) {
      return null;
    }
    for (final session in sessions) {
      if (session.sessionId != sessionId) {
        continue;
      }
      if (session.status == SessionStatus.running ||
          session.status == SessionStatus.replaying) {
        return session;
      }
      return null;
    }
    return null;
  }

  void _openFilePreview(BuildContext context, SessionSummary session) {
    Navigator.of(context).push(
      CupertinoPageRoute(
        builder:
            (_) => FilePreviewPage(
              sessionId: session.sessionId,
              filePath: widget.args.filePath,
              workspacePath: widget.args.workspacePath ?? session.workspacePath,
            ),
      ),
    );
  }
}

class _DiffModeButton extends StatelessWidget {
  const _DiffModeButton({
    required this.label,
    required this.active,
    required this.onPressed,
  });

  final String label;
  final bool active;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoButton(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
      minimumSize: Size.zero,
      borderRadius: BorderRadius.circular(6),
      color: active ? c.bg2 : CupertinoColors.transparent,
      onPressed: onPressed,
      child: Text(
        label,
        style: TextStyle(
          fontSize: 13,
          color: active ? c.fg : c.fg2,
          fontWeight: active ? FontWeight.w600 : FontWeight.w500,
        ),
      ),
    );
  }
}

class _DiffNavButton extends StatelessWidget {
  const _DiffNavButton({
    required this.label,
    required this.enabled,
    required this.onPressed,
  });

  final String label;
  final bool enabled;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoButton(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      minimumSize: Size.zero,
      borderRadius: BorderRadius.circular(8),
      color: enabled ? c.tintBg : c.bg3,
      onPressed: onPressed,
      child: Text(
        label,
        style: TextStyle(fontSize: 14, color: enabled ? c.tint : c.fg3),
      ),
    );
  }
}

const _lineH = 22.0;
