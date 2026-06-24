import 'package:flutter/foundation.dart';
import 'tree_cache.dart';

class TreeNode {
  TreeNode({
    required this.name,
    required this.path,
    required this.isDir,
    this.modified = false,
    this.expanded = false,
    this.loading = false,
    this.children,
  });

  final String name;
  final String path;
  final bool isDir;
  bool modified;
  bool expanded;
  bool loading;
  List<TreeNode>? children;
}

class FlatTreeEntry {
  final TreeNode node;
  final int depth;
  const FlatTreeEntry(this.node, this.depth);
}

class FileTreeController extends ChangeNotifier {
  FileTreeController({required this.onRequestChildren});

  final Future<void> Function(String path) onRequestChildren;

  TreeNode? root;
  List<FlatTreeEntry> flatList = [];
  final _cache = TreeCache();

  void loadRoot(String workspacePath) {
    root = TreeNode(name: workspacePath.split('/').last, path: workspacePath, isDir: true, loading: true);
    _rebuild();
    onRequestChildren(workspacePath);
  }

  void applyResponse(Map<String, dynamic> payload) {
    final workspacePath = payload['workspace_path'] as String? ?? '';
    final dirPath = payload['dir_path'] as String? ?? '';
    final parentPath = dirPath.isEmpty ? workspacePath : '$workspacePath/$dirPath';
    final entries = (payload['entries'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final children = entries.map((j) => TreeNode(
      name: j['name'] as String,
      path: '$workspacePath/${j['path']}',
      isDir: j['type'] == 'dir',
      modified: j['modified'] == true,
    )).toList();
    _cache.put(parentPath, children);
    _applyToNode(root, parentPath, children);
    _rebuild();
  }

  bool _applyToNode(TreeNode? node, String parentPath, List<TreeNode> children) {
    if (node == null) return false;
    if (node.path == parentPath) {
      node.loading = false;
      node.children = children;
      return true;
    }
    for (final child in node.children ?? <TreeNode>[]) {
      if (_applyToNode(child, parentPath, children)) return true;
    }
    return false;
  }

  void toggle(TreeNode node) {
    if (!node.isDir) return;
    node.expanded = !node.expanded;
    if (node.expanded) {
      final cached = _cache.get(node.path);
      if (cached != null) {
        node.children = cached;
      } else if (node.children == null) {
        node.loading = true;
        onRequestChildren(node.path);
      }
    }
    _rebuild();
  }

  void markModified(String path) {
    _markInTree(root, path);
    _rebuild();
  }

  void _markInTree(TreeNode? node, String path) {
    if (node == null) return;
    if (node.path == path) { node.modified = true; return; }
    for (final c in node.children ?? <TreeNode>[]) { _markInTree(c, path); }
  }

  void _rebuild() {
    flatList = [];
    if (root != null) _flatten(root!, 0);
    notifyListeners();
  }

  void _flatten(TreeNode node, int depth) {
    flatList.add(FlatTreeEntry(node, depth));
    if (node.isDir && node.expanded) {
      for (final child in node.children ?? <TreeNode>[]) {
        _flatten(child, depth + 1);
      }
    }
  }
}
