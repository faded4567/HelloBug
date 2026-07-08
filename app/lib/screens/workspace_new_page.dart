import 'package:flutter/cupertino.dart';
import '../theme/index.dart';

/// New workspace form — wireframe 51
class WorkspaceNewPage extends StatefulWidget {
  const WorkspaceNewPage({super.key, this.onSave, this.initialName, this.initialPath});

  final Future<bool> Function(String name, String path)? onSave;
  final String? initialName;
  final String? initialPath;

  @override
  State<WorkspaceNewPage> createState() => _WorkspaceNewPageState();
}

class _WorkspaceNewPageState extends State<WorkspaceNewPage> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _pathCtrl;
  bool _claudeCode = true;
  bool _codex = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.initialName ?? '');
    _pathCtrl = TextEditingController(text: widget.initialPath ?? '');
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _pathCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    final path = _pathCtrl.text.trim();
    if (name.isEmpty || path.isEmpty) return;
    setState(() => _saving = true);
    try {
      if (widget.onSave != null) {
        await widget.onSave!(name, path);
      }
      if (mounted) Navigator.of(context).pop(true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final canSave = _nameCtrl.text.trim().isNotEmpty && _pathCtrl.text.trim().isNotEmpty && !_saving;

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        leading: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: () => Navigator.of(context).pop(),
          child: Text('取消', style: TextStyle(color: c.tint, fontSize: 16)),
        ),
        middle: Text('新建工作区', style: TextStyle(color: c.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: canSave ? _save : null,
          child: Text(
            '添加',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: canSave ? c.tint : c.fg3,
            ),
          ),
        ),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
          children: [
            _Field(label: '工作区名称', child: _buildNameField(c)),
            const SizedBox(height: 24),
            _Field(label: '本地路径', child: _buildPathField(c)),
            const SizedBox(height: 24),
            _Field(label: 'Agent', child: _buildAgentToggles(c)),
            const SizedBox(height: 24),
            _Field(
              label: '描述（可选）',
              child: Container(
                decoration: BoxDecoration(
                  color: c.bg2,
                  border: Border.all(color: c.bg4),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: CupertinoTextField(
                  placeholder: '这个工作区是用来做什么的…',
                  placeholderStyle: TextStyle(color: c.fg3, fontSize: 14),
                  style: TextStyle(fontSize: 14, color: c.fg),
                  maxLines: 3,
                  padding: const EdgeInsets.all(12),
                  decoration: const BoxDecoration(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNameField(ThemeColors c) {
    return Container(
      decoration: BoxDecoration(
        color: c.bg2,
        border: Border.all(color: c.bg4),
        borderRadius: BorderRadius.circular(10),
      ),
      child: CupertinoTextField(
        controller: _nameCtrl,
        style: TextStyle(fontSize: 15, color: c.fg),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: const BoxDecoration(),
      ),
    );
  }

  Widget _buildPathField(ThemeColors c) {
    return Row(
      children: [
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: c.bg2,
              border: Border.all(color: c.bg4),
              borderRadius: BorderRadius.circular(10),
            ),
            child: CupertinoTextField(
              controller: _pathCtrl,
              readOnly: true,
              style: TextStyle(
                fontSize: 13,
                color: c.fg3,
                fontFamily: 'SF Mono',
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: const BoxDecoration(),
            ),
          ),
        ),
        const SizedBox(width: 8),
        CupertinoButton(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          color: c.bg2,
          borderRadius: BorderRadius.circular(10),
          onPressed: () {
            // TODO: browse directories (platform channel)
          },
          child: Text('浏览', style: TextStyle(fontSize: 13, color: c.tint)),
        ),
      ],
    );
  }

  Widget _buildAgentToggles(ThemeColors c) {
    return Container(
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          _AgentToggle(
            name: 'Claude Code',
            subtitle: 'claude-sonnet-4-5',
            active: _claudeCode,
            onChanged: (v) => setState(() => _claudeCode = v),
            c: c,
          ),
          Container(height: 1, color: c.bg3),
          _AgentToggle(
            name: 'Codex CLI',
            subtitle: 'gpt-4o',
            active: _codex,
            onChanged: (v) => setState(() => _codex = v),
            c: c,
          ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.child});
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            label.toUpperCase(),
            style: TextStyle(
              fontSize: 12,
              color: context.colors.fg3,
              letterSpacing: .6,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        child,
      ],
    );
  }
}

class _AgentToggle extends StatelessWidget {
  const _AgentToggle({
    required this.name,
    required this.subtitle,
    required this.active,
    required this.onChanged,
    required this.c,
  });

  final String name;
  final String subtitle;
  final bool active;
  final ValueChanged<bool> onChanged;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(
                    fontSize: 15,
                    color: active ? c.fg : c.fg2,
                  ),
                ),
                Text(
                  subtitle,
                  style: TextStyle(fontSize: 12, color: c.fg3),
                ),
              ],
            ),
          ),
          CupertinoSwitch(
            value: active,
            onChanged: onChanged,
            activeTrackColor: c.tint,
          ),
        ],
      ),
    );
  }
}
