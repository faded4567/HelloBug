import 'file_tree_controller.dart';

class TreeCache {
  final Map<String, List<TreeNode>> _cache = {};

  bool has(String path) => _cache.containsKey(path);

  List<TreeNode>? get(String path) => _cache[path];

  void put(String path, List<TreeNode> children) => _cache[path] = children;

  void invalidate(String path) => _cache.remove(path);

  void clear() => _cache.clear();
}
