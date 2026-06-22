import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../state/settings_provider.dart';
import '../../theme/index.dart';

class DangerRulesPage extends ConsumerWidget {
  const DangerRulesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rules = ref.watch(settingsProvider).dangerRules;
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('危险规则', style: TextStyle(color: c.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: () => _showEditSheet(context, ref, null),
          child: Icon(CupertinoIcons.add, color: c.tint),
        ),
      ),
      child: SafeArea(
        child: rules.isEmpty
            ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Text('🛡', style: const TextStyle(fontSize: 40)),
                const SizedBox(height: 12),
                Text('还没有自定义规则', style: TextStyle(color: c.fg2)),
                const SizedBox(height: 6),
                Text('默认允许所有操作', style: TextStyle(fontSize: 13, color: c.fg3)),
              ]))
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _SectionNote(c: c),
                  const SizedBox(height: 12),
                  ...rules.map((r) => _RuleTile(
                    rule: r,
                    onToggle: (v) => ref.read(settingsProvider.notifier).update((s) =>
                      s.copyWith(dangerRules: s.dangerRules
                        .map((x) => x.id == r.id ? DangerRule(id: x.id, pattern: x.pattern, description: x.description, enabled: v) : x)
                        .toList())),
                    onEdit: () => _showEditSheet(context, ref, r),
                    onDelete: () => ref.read(settingsProvider.notifier).update((s) =>
                      s.copyWith(dangerRules: s.dangerRules.where((x) => x.id != r.id).toList())),
                  )),
                ],
              ),
      ),
    );
  }

  void _showEditSheet(BuildContext ctx, WidgetRef ref, DangerRule? existing) {
    showCupertinoModalPopup<void>(
      context: ctx,
      builder: (_) => _RuleEditSheet(existing: existing, onSave: (rule) {
        ref.read(settingsProvider.notifier).update((s) {
          if (existing == null) {
            return s.copyWith(dangerRules: [...s.dangerRules, rule]);
          }
          return s.copyWith(dangerRules: s.dangerRules.map((x) => x.id == rule.id ? rule : x).toList());
        });
      }),
    );
  }
}

class _SectionNote extends StatelessWidget {
  const _SectionNote({required this.c});
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(10)),
      child: Text('规则在 daemon 侧执行，Flutter 仅负责管理。pattern 为正则表达式，匹配命令字符串。',
        style: TextStyle(fontSize: 13, color: c.fg2, height: 1.5)),
    );
  }
}

class _RuleTile extends StatelessWidget {
  const _RuleTile({required this.rule, required this.onToggle, required this.onEdit, required this.onDelete});
  final DangerRule rule;
  final ValueChanged<bool> onToggle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return GestureDetector(
      onLongPress: onEdit,
      child: Dismissible(
        key: Key(rule.id),
        direction: DismissDirection.endToStart,
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(color: AppColors.red, borderRadius: BorderRadius.circular(12)),
          child: const Icon(CupertinoIcons.delete, color: Color(0xFFFFFFFF)),
        ),
        onDismissed: (_) => onDelete(),
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
          child: Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(rule.pattern,
                style: TextStyle(fontSize: 13, fontFamily: 'Menlo', color: rule.enabled ? c.fg : c.fg3)),
              const SizedBox(height: 2),
              Text(rule.description, style: TextStyle(fontSize: 13, color: c.fg2)),
            ])),
            const SizedBox(width: 8),
            CupertinoSwitch(value: rule.enabled, onChanged: onToggle, activeTrackColor: c.tint),
          ]),
        ),
      ),
    );
  }
}

class _RuleEditSheet extends StatefulWidget {
  const _RuleEditSheet({required this.existing, required this.onSave});
  final DangerRule? existing;
  final ValueChanged<DangerRule> onSave;

  @override
  State<_RuleEditSheet> createState() => _RuleEditSheetState();
}

class _RuleEditSheetState extends State<_RuleEditSheet> {
  late final TextEditingController _pattern;
  late final TextEditingController _desc;
  String? _patternError;

  @override
  void initState() {
    super.initState();
    _pattern = TextEditingController(text: widget.existing?.pattern ?? '');
    _desc    = TextEditingController(text: widget.existing?.description ?? '');
  }

  @override
  void dispose() {
    _pattern.dispose();
    _desc.dispose();
    super.dispose();
  }

  void _save() {
    try {
      RegExp(_pattern.text); // validate
    } catch (_) {
      setState(() => _patternError = '无效的正则表达式');
      return;
    }
    if (_pattern.text.trim().isEmpty) {
      setState(() => _patternError = '不能为空');
      return;
    }
    final id = widget.existing?.id ?? DateTime.now().millisecondsSinceEpoch.toString();
    widget.onSave(DangerRule(id: id, pattern: _pattern.text.trim(), description: _desc.text.trim()));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).viewInsets.bottom + 32),
      decoration: BoxDecoration(color: c.bg2, borderRadius: const BorderRadius.vertical(top: AppRadius.lg)),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: Container(width: 36, height: 4,
          decoration: BoxDecoration(color: c.bg4, borderRadius: BorderRadius.circular(2)))),
        const SizedBox(height: 16),
        Text(widget.existing == null ? '新建规则' : '编辑规则',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: c.fg)),
        const SizedBox(height: 16),
        _Field(label: 'Pattern (正则)', controller: _pattern, mono: true,
          error: _patternError, placeholder: r'rm\s+-rf|DROP\s+TABLE'),
        const SizedBox(height: 12),
        _Field(label: '描述', controller: _desc, placeholder: '说明这条规则的用途'),
        const SizedBox(height: 20),
        Row(children: [
          Expanded(child: CupertinoButton(
            padding: const EdgeInsets.symmetric(vertical: 14),
            color: c.bg3,
            borderRadius: BorderRadius.circular(12),
            onPressed: () => Navigator.of(context).pop(),
            child: Text('取消', style: TextStyle(color: c.fg)),
          )),
          const SizedBox(width: 12),
          Expanded(child: CupertinoButton.filled(
            padding: const EdgeInsets.symmetric(vertical: 14),
            borderRadius: BorderRadius.circular(12),
            onPressed: _save,
            child: Text(widget.existing == null ? '添加' : '保存'),
          )),
        ]),
      ]),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.controller, this.placeholder, this.mono = false, this.error});
  final String label;
  final TextEditingController controller;
  final String? placeholder;
  final bool mono;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: TextStyle(fontSize: 13, color: c.fg2)),
      const SizedBox(height: 6),
      CupertinoTextField(
        controller: controller,
        placeholder: placeholder,
        placeholderStyle: TextStyle(color: c.fg3),
        style: TextStyle(color: c.fg, fontFamily: mono ? 'Menlo' : null, fontSize: 14),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: c.bg3,
          borderRadius: BorderRadius.circular(10),
          border: error != null ? Border.all(color: AppColors.red) : null,
        ),
        autocorrect: false,
      ),
      if (error != null) ...[
        const SizedBox(height: 4),
        Text(error!, style: const TextStyle(fontSize: 12, color: AppColors.red)),
      ],
    ]);
  }
}
