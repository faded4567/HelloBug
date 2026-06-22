import 'package:flutter/foundation.dart';

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

  void loadRoot(String workspacePath) {
    root = TreeNode(name: workspacePath.split('/').last, path: workspacePath, isDir: true, loading: true);
    _rebuild();
    onRequestChildren(workspacePath);
  }

  void applyResponse(Map<String, dynamic> payload) {
    final parentPath = payload['path'] as String? ?? '';
    final items = (payload['items'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final children = items.map((j) => TreeNode(
      name: j['name'] as String,
      path: j['path'] as String,
      isDir: j['is_dir'] as bool? ?? false,
      modified: j['modified'] as bool? ?? false,
    )).toList();
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
    if (node.expanded && node.children == null) {
      node.loading = true;
      onRequestChildren(node.path);
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
