import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/workspace_summary.dart';
import '../../state/workspace_history_provider.dart';
import '../../state/workspaces_provider.dart';
import '../../theme/index.dart';

class WorkspaceSwitchSheet extends ConsumerStatefulWidget {
  const WorkspaceSwitchSheet({
    super.key,
    required this.currentPath,
    required this.onSwitch,
  });
  final String currentPath;
  final void Function(String path) onSwitch;

  @override
  ConsumerState<WorkspaceSwitchSheet> createState() =>
      _WorkspaceSwitchSheetState();
}

class _WorkspaceSwitchSheetState extends ConsumerState<WorkspaceSwitchSheet> {
  final _textCtrl = TextEditingController();
  bool _showInput = false;
  bool _submitting = false;
  String? _inputError;

  @override
  void initState() {
    super.initState();
    final current = ref.read(workspacesProvider);
    if (!current.isLoading) {
      unawaited(ref.read(workspacesProvider.notifier).refresh());
    }
  }

  @override
  void dispose() {
    _textCtrl.dispose();
    super.dispose();
  }

  void _select(String path) {
    ref.read(workspaceHistoryProvider.notifier).visit(path);
    Navigator.of(context).pop();
    widget.onSwitch(path);
  }

  Future<void> _submitCustom() async {
    final path = _textCtrl.text.trim();
    if (path.isEmpty || _submitting) {
      return;
    }

    setState(() {
      _submitting = true;
      _inputError = null;
    });
    try {
      final resolved = await ref
          .read(workspacesProvider.notifier)
          .resolveWorkspace(path);
      if (!resolved.isReady) {
        throw StateError(_workspaceStatusText(resolved.status));
      }
      if (!mounted) {
        return;
      }
      _select(resolved.path);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _inputError = _friendlyResolveError(error);
      });
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final history =
        ref.watch(workspaceHistoryProvider).valueOrNull ??
        WorkspaceHistory.empty;
    final remoteCatalog = ref.watch(workspacesProvider);
    final remoteItems = remoteCatalog.valueOrNull?.items ?? const [];
    final remoteByPath = {for (final item in remoteItems) item.path: item};
    final pinnedPaths = history.pinned.toList(growable: false);
    final recentPaths =
        history.recents
            .where((path) => !history.pinned.contains(path))
            .toList();
    final consumed = <String>{...pinnedPaths, ...recentPaths};
    final availableItems =
        remoteItems.where((item) => !consumed.contains(item.path)).toList();

    return Container(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        MediaQuery.of(context).viewInsets.bottom + 32,
      ),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: c.bg4,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            '切换工作区',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: c.fg,
            ),
          ),
          const SizedBox(height: 12),
          if (pinnedPaths.isNotEmpty) ...[
            Text('置顶', style: TextStyle(fontSize: 12, color: c.fg3)),
            const SizedBox(height: 6),
            for (final path in pinnedPaths)
              _WorkspaceTile(
                item: _tileItemForPath(path, remoteByPath: remoteByPath),
                isActive: path == widget.currentPath,
                isPinned: true,
                colors: c,
                onTap: () => unawaited(_handleTap(path, remoteByPath[path])),
                onLongPress:
                    () => ref
                        .read(workspaceHistoryProvider.notifier)
                        .togglePin(path),
              ),
            const SizedBox(height: 10),
          ],
          if (recentPaths.isNotEmpty) ...[
            Text('最近', style: TextStyle(fontSize: 12, color: c.fg3)),
            const SizedBox(height: 6),
            for (final path in recentPaths)
              _WorkspaceTile(
                item: _tileItemForPath(path, remoteByPath: remoteByPath),
                isActive: path == widget.currentPath,
                isPinned: false,
                colors: c,
                onTap: () => unawaited(_handleTap(path, remoteByPath[path])),
                onLongPress:
                    () => ref
                        .read(workspaceHistoryProvider.notifier)
                        .togglePin(path),
              ),
            const SizedBox(height: 10),
          ],
          if (availableItems.isNotEmpty) ...[
            Text('可用', style: TextStyle(fontSize: 12, color: c.fg3)),
            const SizedBox(height: 6),
            for (final item in availableItems)
              _WorkspaceTile(
                item: _WorkspaceTileItem.fromSummary(item),
                isActive: item.path == widget.currentPath,
                isPinned: false,
                colors: c,
                onTap: () => unawaited(_handleTap(item.path, item)),
                onLongPress:
                    () => ref
                        .read(workspaceHistoryProvider.notifier)
                        .togglePin(item.path),
              ),
            const SizedBox(height: 10),
          ],
          if (pinnedPaths.isEmpty &&
              recentPaths.isEmpty &&
              availableItems.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Center(
                child:
                    remoteCatalog.isLoading
                        ? const CupertinoActivityIndicator()
                        : Text(
                          remoteCatalog.hasError ? '工作区列表读取失败' : '暂无最近工作区',
                          style: TextStyle(fontSize: 14, color: c.fg3),
                        ),
              ),
            ),
          Container(height: 1, color: c.separator),
          const SizedBox(height: 12),
          if (_showInput) ...[
            CupertinoTextField(
              controller: _textCtrl,
              autofocus: true,
              placeholder: '/Users/xxx/projects/my-app',
              style: TextStyle(fontSize: 14, fontFamily: 'Menlo', color: c.fg),
              placeholderStyle: TextStyle(fontSize: 14, color: c.fg3),
              decoration: BoxDecoration(
                color: c.bg3,
                borderRadius: BorderRadius.circular(8),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              onSubmitted: (_) => _submitCustom(),
            ),
            if (_inputError != null) ...[
              const SizedBox(height: 8),
              Text(
                _inputError!,
                style: const TextStyle(fontSize: 12, color: AppColors.red),
              ),
            ],
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: CupertinoButton.filled(
                padding: const EdgeInsets.symmetric(vertical: 12),
                onPressed: _submitting ? null : _submitCustom,
                child:
                    _submitting
                        ? const CupertinoActivityIndicator()
                        : const Text('确认', style: TextStyle(fontSize: 15)),
              ),
            ),
          ] else
            GestureDetector(
              onTap:
                  () => setState(() {
                    _showInput = true;
                    _inputError = null;
                  }),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: c.tintBg,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      '＋',
                      style: TextStyle(fontSize: 20, color: c.tint),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    '输入其他路径…',
                    style: TextStyle(fontSize: 15, color: c.tint),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _handleTap(String path, WorkspaceSummary? summary) async {
    try {
      final resolvedSummary =
          summary ??
          await ref.read(workspacesProvider.notifier).resolveWorkspace(path);
      if (!mounted) {
        return;
      }
      if (!resolvedSummary.isReady) {
        unawaited(
          showCupertinoDialog<void>(
            context: context,
            builder:
                (dialogContext) => CupertinoAlertDialog(
                  title: const Text('无法切换到该工作区'),
                  content: Text(_workspaceStatusText(resolvedSummary.status)),
                  actions: [
                    CupertinoDialogAction(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      child: const Text('知道了'),
                    ),
                  ],
                ),
          ),
        );
        return;
      }
      _select(resolvedSummary.path);
    } catch (error) {
      if (!mounted) {
        return;
      }
      unawaited(
        showCupertinoDialog<void>(
          context: context,
          builder:
              (dialogContext) => CupertinoAlertDialog(
                title: const Text('工作区校验失败'),
                content: Text(_friendlyResolveError(error)),
                actions: [
                  CupertinoDialogAction(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('知道了'),
                  ),
                ],
              ),
        ),
      );
    }
  }

  _WorkspaceTileItem _tileItemForPath(
    String path, {
    required Map<String, WorkspaceSummary> remoteByPath,
  }) {
    final remote = remoteByPath[path];
    if (remote != null) {
      return _WorkspaceTileItem.fromSummary(remote);
    }

    final name = path
        .split('/')
        .lastWhere((part) => part.isNotEmpty, orElse: () => path);
    return _WorkspaceTileItem(
      path: path,
      name: name,
      note: '最近使用',
      status: null,
      isEnabled: true,
    );
  }

  String _friendlyResolveError(Object error) {
    if (error is StateError) {
      return error.message.toString();
    }
    return '工作区校验失败，请稍后重试';
  }
}

class _WorkspaceTile extends StatelessWidget {
  const _WorkspaceTile({
    required this.item,
    required this.isActive,
    required this.isPinned,
    required this.colors,
    required this.onTap,
    required this.onLongPress,
  });
  final _WorkspaceTileItem item;
  final bool isActive;
  final bool isPinned;
  final ThemeColors colors;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final canTap = item.isEnabled;
    return GestureDetector(
      onTap: canTap ? onTap : null,
      onLongPress: onLongPress,
      child: Opacity(
        opacity: canTap ? 1 : 0.7,
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: isActive ? colors.tintBg : colors.bg3,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isActive ? colors.tint : colors.separator,
              width: isActive ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Text(
                isPinned ? '📌' : '📁',
                style: const TextStyle(fontSize: 18),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: colors.fg,
                      ),
                    ),
                    Text(
                      item.path,
                      style: TextStyle(
                        fontSize: 12,
                        color: colors.fg3,
                        fontFamily: 'Menlo',
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (item.note != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          item.note!,
                          style: TextStyle(fontSize: 12, color: colors.fg2),
                        ),
                      ),
                  ],
                ),
              ),
              if (isActive)
                Icon(CupertinoIcons.checkmark_alt, size: 16, color: colors.tint)
              else if (item.status != null)
                Text(
                  item.status!,
                  style: TextStyle(fontSize: 12, color: colors.fg3),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WorkspaceTileItem {
  const _WorkspaceTileItem({
    required this.path,
    required this.name,
    required this.isEnabled,
    this.note,
    this.status,
  });

  final String path;
  final String name;
  final bool isEnabled;
  final String? note;
  final String? status;

  factory _WorkspaceTileItem.fromSummary(WorkspaceSummary summary) =>
      _WorkspaceTileItem(
        path: summary.path,
        name: summary.name,
        isEnabled: summary.isReady,
        note: _workspaceEntryNote(summary),
        status:
            summary.isDefault
                ? '默认'
                : summary.isReady
                ? null
                : _workspaceStatusText(summary.status),
      );
}

String _workspaceEntryNote(WorkspaceSummary summary) {
  if (!summary.isReady) {
    return switch (summary.status) {
      WorkspaceStatus.missing => '目录不存在',
      WorkspaceStatus.forbidden => '无访问权限',
      WorkspaceStatus.notDir => '不是文件夹',
      WorkspaceStatus.ready => '可用',
    };
  }
  final count = summary.entryCount;
  if (count == null) {
    return '可用';
  }
  if (count == 0) {
    return '空目录';
  }
  return '$count 项';
}

String _workspaceStatusText(WorkspaceStatus status) {
  return switch (status) {
    WorkspaceStatus.ready => '就绪',
    WorkspaceStatus.missing => '不存在',
    WorkspaceStatus.forbidden => '无权限',
    WorkspaceStatus.notDir => '非目录',
  };
}
