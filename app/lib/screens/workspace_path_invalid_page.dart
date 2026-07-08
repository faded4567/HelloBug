import 'package:flutter/cupertino.dart';
import '../theme/index.dart';

/// Workspace path invalid — wireframe 49
class WorkspacePathInvalidPage extends StatelessWidget {
  const WorkspacePathInvalidPage({
    super.key,
    required this.workspacePath,
    this.repairHint,
    this.onSelectOther,
  });

  final String workspacePath;
  final String? repairHint;
  final VoidCallback? onSelectOther;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text(
          workspacePath.split('/').lastOrNull ?? '工作区',
          style: TextStyle(color: c.fg),
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            // Red warning banner
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.red.withValues(alpha: .1),
                border: Border(
                  bottom: BorderSide(
                    color: AppColors.red.withValues(alpha: .2),
                  ),
                ),
              ),
              child: Row(
                children: [
                  const Text('⚠️', style: TextStyle(fontSize: 16)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '工作区路径不存在',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: AppColors.red,
                          ),
                        ),
                        Text(
                          workspacePath,
                          style: TextStyle(
                            fontSize: 11,
                            color: c.fg3,
                            fontFamily: 'SF Mono',
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('📂', style: TextStyle(fontSize: 52, color: c.fg3.withValues(alpha: .25))),
                      const SizedBox(height: 12),
                      Text(
                        '目录已被移动或删除',
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.fg),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        repairHint ?? '该目录在 Mac 上可能已被重命名、移动或删除。请检查路径拼写或在 Mac 上恢复该目录。',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14, color: c.fg2, height: 1.6),
                      ),
                      const SizedBox(height: 16),
                      if (onSelectOther != null)
                        CupertinoButton.filled(
                          onPressed: onSelectOther,
                          child: const Text('选择其他工作区'),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
