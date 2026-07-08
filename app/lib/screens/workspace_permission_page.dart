import 'package:flutter/cupertino.dart';
import '../theme/index.dart';

/// Workspace permission restricted — wireframe 60.
///
/// Variant A: read-only (orange banner)
/// Variant B: completely denied (red full screen)
class WorkspacePermissionPage extends StatelessWidget {
  const WorkspacePermissionPage({
    super.key,
    required this.workspacePath,
    this.currentPermission,
    this.requiredPermission,
    this.fixCommand,
    this.repairHints,
    this.isFullyDenied = false,
    this.onRetryCheck,
    this.onContinueReadOnly,
    this.onSelectOther,
  });

  final String workspacePath;
  final String? currentPermission;
  final String? requiredPermission;
  final String? fixCommand;
  final List<String>? repairHints;
  final bool isFullyDenied;
  final VoidCallback? onRetryCheck;
  final VoidCallback? onContinueReadOnly;
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
          workspacePath.split('/').lastOrNull ?? workspacePath,
          style: TextStyle(color: c.fg),
        ),
      ),
      child: SafeArea(
        child:
            isFullyDenied
                ? _buildFullyDenied(c)
                : _buildReadOnly(c),
      ),
    );
  }

  Widget _buildReadOnly(ThemeColors c) {
    return Column(
      children: [
        // orange banner
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.orange.withValues(alpha: .1),
            border: Border(
              bottom: BorderSide(
                color: AppColors.orange.withValues(alpha: .2),
              ),
            ),
          ),
          child: Row(
            children: [
              const Text('🔒', style: TextStyle(fontSize: 16)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '只读模式 — 权限不足',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.orange,
                      ),
                    ),
                    Text(
                      'Agent 无法写入工作区文件',
                      style: TextStyle(fontSize: 11, color: c.fg3),
                    ),
                  ],
                ),
              ),
              Text(
                '如何修复',
                style: TextStyle(fontSize: 12, color: c.tint),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // permission details card
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '权限详情',
                      style: TextStyle(
                        fontSize: 12,
                        color: c.fg3,
                        fontWeight: FontWeight.w600,
                        letterSpacing: .6,
                      ),
                    ),
                    const SizedBox(height: 10),
                    _PermRow(label: '工作区路径', value: workspacePath, c: c, mono: true),
                    if (currentPermission != null)
                      _PermRow(label: '当前权限', value: currentPermission!, c: c, valueColor: AppColors.orange),
                    if (requiredPermission != null)
                      _PermRow(label: '所需权限', value: requiredPermission!, c: c, valueColor: AppColors.green),
                  ],
                ),
              ),
              if (fixCommand != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: c.bg2,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '在 Mac 上执行',
                        style: TextStyle(
                          fontSize: 12,
                          color: c.fg3,
                          fontWeight: FontWeight.w600,
                          letterSpacing: .6,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: c.bg3,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          fixCommand!,
                          style: TextStyle(
                            fontSize: 12,
                            color: c.tint,
                            fontFamily: 'SF Mono',
                            height: 1.8,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              if (onRetryCheck != null)
                SizedBox(
                  width: double.infinity,
                  child: CupertinoButton.filled(
                    onPressed: onRetryCheck,
                    child: const Text('已修复，重新检测权限'),
                  ),
                ),
              if (onContinueReadOnly != null) ...[
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: CupertinoButton(
                    onPressed: onContinueReadOnly,
                    color: c.bg2,
                    borderRadius: BorderRadius.circular(12),
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    child: Text(
                      '以只读模式继续（仅可查看）',
                      style: TextStyle(fontSize: 14, color: c.tint),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFullyDenied(ThemeColors c) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.red.withValues(alpha: .12),
              ),
              alignment: Alignment.center,
              child: const Text('🚫', style: TextStyle(fontSize: 36)),
            ),
            const SizedBox(height: 16),
            Text(
              '无法访问工作区',
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w700,
                color: AppColors.red,
              ),
            ),
            const SizedBox(height: 10),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: 'Agent 对 ',
                    style: TextStyle(fontSize: 13, color: c.fg2),
                  ),
                  TextSpan(
                    text: workspacePath.split('/').lastOrNull ?? workspacePath,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: c.fg,
                    ),
                  ),
                  TextSpan(
                    text: ' 工作区没有任何访问权限，可能是因为目录归属或 SIP 限制。',
                    style: TextStyle(fontSize: 13, color: c.fg2),
                  ),
                ],
              ),
              textAlign: TextAlign.center,
              style: const TextStyle(height: 1.7),
            ),
            if (repairHints != null && repairHints!.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '可能原因',
                      style: TextStyle(fontSize: 12, color: c.fg3),
                    ),
                    const SizedBox(height: 8),
                    ...repairHints!.map(
                      (h) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Text(
                          '• $h',
                          style: TextStyle(
                            fontSize: 13,
                            color: c.fg2,
                            height: 1.8,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 4),
            if (onRetryCheck != null)
              SizedBox(
                width: double.infinity,
                child: CupertinoButton.filled(
                  onPressed: onRetryCheck,
                  child: const Text('查看详细修复指引'),
                ),
              ),
            if (onSelectOther != null)
              CupertinoButton(
                onPressed: onSelectOther,
                child: Text(
                  '选择其他工作区',
                  style: TextStyle(fontSize: 13, color: c.fg3),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PermRow extends StatelessWidget {
  const _PermRow({
    required this.label,
    required this.value,
    required this.c,
    this.valueColor,
    this.mono = false,
  });
  final String label;
  final String value;
  final ThemeColors c;
  final Color? valueColor;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: 13, color: c.fg2)),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                fontSize: mono ? 11 : 13,
                color: valueColor ?? c.fg,
                fontFamily: mono ? 'SF Mono' : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
