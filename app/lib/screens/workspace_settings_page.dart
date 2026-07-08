import 'package:flutter/cupertino.dart';
import '../theme/index.dart';

/// Workspace settings page — wireframe 45
class WorkspaceSettingsPage extends StatefulWidget {
  const WorkspaceSettingsPage({
    super.key,
    required this.workspacePath,
    this.workspaceName,
    this.deviceName,
    this.agents,
    this.onDelete,
  });

  final String workspacePath;
  final String? workspaceName;
  final String? deviceName;
  final List<AgentEntry>? agents;
  final VoidCallback? onDelete;

  @override
  State<WorkspaceSettingsPage> createState() => _WorkspaceSettingsPageState();
}

class _WorkspaceSettingsPageState extends State<WorkspaceSettingsPage> {
  late final TextEditingController _nameCtrl;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.workspaceName ?? '');
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('工作区设置', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            // ── Basic info ──
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
              child: Text(
                '基本信息',
                style: TextStyle(
                  fontSize: 12,
                  color: c.fg3,
                  fontWeight: FontWeight.w600,
                  letterSpacing: .6,
                ),
              ),
            ),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 0),
              decoration: BoxDecoration(
                color: c.bg2,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  _SettingField(
                    label: '工作区名称',
                    child: CupertinoTextField(
                      controller: _nameCtrl,
                      style: TextStyle(fontSize: 15, color: c.fg),
                      padding: EdgeInsets.zero,
                      decoration: const BoxDecoration(),
                    ),
                  ),
                  Container(height: 1, color: c.separator, margin: const EdgeInsets.only(left: 16)),
                  _SettingField(
                    label: '工作目录',
                    child: Text(
                      widget.workspacePath,
                      style: TextStyle(
                        fontSize: 13,
                        color: c.fg2,
                        fontFamily: 'SF Mono',
                      ),
                    ),
                  ),
                  Container(height: 1, color: c.separator, margin: const EdgeInsets.only(left: 16)),
                  _SettingField(
                    label: '设备',
                    child: Text(
                      '💻 ${widget.deviceName ?? "未绑定"}',
                      style: TextStyle(fontSize: 15, color: c.fg),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // ── Agents ──
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Agent',
                      style: TextStyle(
                        fontSize: 12,
                        color: c.fg3,
                        fontWeight: FontWeight.w600,
                        letterSpacing: .6,
                      ),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => _showAddAgent(c),
                    child: Text('＋ 添加', style: TextStyle(fontSize: 14, color: c.tint)),
                  ),
                ],
              ),
            ),
            Container(
              decoration: BoxDecoration(
                color: c.bg2,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  for (final agent in widget.agents ?? _defaultAgents)
                    _AgentSettingRow(agent: agent),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // ── Danger zone ──
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Text(
                '危险操作',
                style: TextStyle(
                  fontSize: 12,
                  color: c.fg3,
                  fontWeight: FontWeight.w600,
                  letterSpacing: .6,
                ),
              ),
            ),
            GestureDetector(
              onTap: widget.onDelete,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(12),
                ),
                alignment: Alignment.center,
                child: Text(
                  '删除工作区',
                  style: TextStyle(fontSize: 15, color: AppColors.red),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showAddAgent(ThemeColors c) {
    showCupertinoModalPopup<void>(
      context: context,
      builder: (_) => _AddAgentSheet(c: c),
    );
  }
}

List<AgentEntry> get _defaultAgents => const [
  AgentEntry(icon: '🤖', name: 'claude-code', subtitle: 'Claude Code · claude-sonnet-4-5', enabled: true),
  AgentEntry(icon: '🤖', name: 'codex', subtitle: 'Codex CLI · gpt-4o', enabled: false),
];

class _SettingField extends StatelessWidget {
  const _SettingField({required this.label, required this.child});
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 12, color: context.colors.fg3),
          ),
          const SizedBox(height: 4),
          child,
        ],
      ),
    );
  }
}

class _AgentSettingRow extends StatelessWidget {
  const _AgentSettingRow({required this.agent});
  final AgentEntry agent;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: agent.enabled ? c.tint.withValues(alpha: .15) : c.bg3,
            ),
            alignment: Alignment.center,
            child: Text(agent.icon, style: const TextStyle(fontSize: 18)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Opacity(
              opacity: agent.enabled ? 1.0 : .55,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    agent.name,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: c.fg,
                    ),
                  ),
                  Text(
                    agent.subtitle,
                    style: TextStyle(fontSize: 12, color: c.fg2),
                  ),
                ],
              ),
            ),
          ),
          CupertinoSwitch(
            value: agent.enabled,
            onChanged: (_) {},
            activeTrackColor: c.tint,
          ),
        ],
      ),
    );
  }
}

class AgentEntry {
  const AgentEntry({
    required this.icon,
    required this.name,
    required this.subtitle,
    required this.enabled,
  });
  final String icon;
  final String name;
  final String subtitle;
  final bool enabled;
}

/// Add agent sheet — wireframe 45-B
class _AddAgentSheet extends StatelessWidget {
  const _AddAgentSheet({required this.c});
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // handle
            Container(
              width: 36,
              height: 5,
              margin: const EdgeInsets.only(top: 8, bottom: 14),
              decoration: BoxDecoration(
                color: c.fg3,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            // header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: Text('取消', style: TextStyle(fontSize: 15, color: c.tint)),
                  ),
                  const Spacer(),
                  Text(
                    '添加 Agent',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.fg),
                  ),
                  const Spacer(),
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: Text(
                      '添加',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: c.tint,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // type select
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '选择类型',
                    style: TextStyle(
                      fontSize: 12,
                      color: c.fg3,
                      fontWeight: FontWeight.w600,
                      letterSpacing: .4,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    decoration: BoxDecoration(
                      color: c.bg2,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      children: [
                        _TypeRow(icon: '🤖', name: 'Claude Code', subtitle: 'Anthropic · claude-*', selected: true, c: c),
                        Container(height: 1, color: c.separator),
                        _TypeRow(icon: '🤖', name: 'Codex CLI', subtitle: 'OpenAI · gpt-*', selected: false, c: c),
                        Container(height: 1, color: c.separator),
                        _TypeRow(icon: '🔧', name: '自定义', subtitle: '配置命令行启动脚本', selected: false, c: c),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TypeRow extends StatelessWidget {
  const _TypeRow({
    required this.icon,
    required this.name,
    required this.subtitle,
    required this.selected,
    required this.c,
  });
  final String icon;
  final String name;
  final String subtitle;
  final bool selected;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: selected ? c.tint.withValues(alpha: .08) : null,
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: selected ? c.tint.withValues(alpha: .2) : c.bg3,
            ),
            alignment: Alignment.center,
            child: Text(icon, style: const TextStyle(fontSize: 18)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.fg),
                ),
                Text(
                  subtitle,
                  style: TextStyle(fontSize: 12, color: c.fg2),
                ),
              ],
            ),
          ),
          if (selected)
            Icon(CupertinoIcons.checkmark_alt, size: 14, color: c.tint),
        ],
      ),
    );
  }
}
