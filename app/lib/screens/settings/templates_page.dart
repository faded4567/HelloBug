import 'package:flutter/cupertino.dart';
import '../../models/template_summary.dart';
import '../../theme/index.dart';

class TemplatesPage extends StatefulWidget {
  const TemplatesPage({super.key});

  @override
  State<TemplatesPage> createState() => _TemplatesPageState();
}

class _TemplatesPageState extends State<TemplatesPage> {
  late List<TemplateSummary> _templates;

  @override
  void initState() {
    super.initState();
    _templates = List.from(kDefaultTemplates);
  }

  void _openForm({TemplateSummary? existing}) {
    showCupertinoModalPopup<TemplateSummary?>(
      context: context,
      builder: (_) => _TemplateFormSheet(existing: existing),
    ).then((result) {
      if (result == null) return;
      setState(() {
        if (existing == null) {
          _templates.add(result);
        } else {
          final idx = _templates.indexWhere((t) => t.id == existing.id);
          if (idx >= 0) _templates[idx] = result;
        }
      });
    });
  }

  void _delete(TemplateSummary t) {
    setState(() => _templates.removeWhere((x) => x.id == t.id));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('快捷模板', style: TextStyle(color: c.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: () => _openForm(),
          child: Icon(CupertinoIcons.add, color: c.tint),
        ),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              '模板在输入栏横划芯片区显示，支持变量占位符 {变量名}。',
              style: TextStyle(fontSize: 13, color: c.fg2, height: 1.5),
            ),
            const SizedBox(height: 12),
            ..._templates.map((t) => _TemplateTile(
              template: t,
              onTap: () => _openForm(existing: t),
              onDelete: () => _delete(t),
              c: c,
            )),
            const SizedBox(height: 8),
            GestureDetector(
              onTap: () => _openForm(),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: c.bg2, borderRadius: BorderRadius.circular(12)),
                child: Row(children: [
                  Container(
                    width: 28, height: 28,
                    decoration: BoxDecoration(
                      color: c.tintBg, shape: BoxShape.circle),
                    alignment: Alignment.center,
                    child: Text('＋',
                      style: TextStyle(fontSize: 18, color: c.tint)),
                  ),
                  const SizedBox(width: 10),
                  Text('新建模板', style: TextStyle(fontSize: 15, color: c.tint)),
                ]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TemplateTile extends StatelessWidget {
  const _TemplateTile({
    required this.template,
    required this.onTap,
    required this.onDelete,
    required this.c,
  });
  final TemplateSummary template;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    final vars = RegExp(r'\{(\w+)\}').allMatches(template.content)
        .map((m) => m.group(0)!).toSet().toList();
    return Dismissible(
      key: Key(template.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(
          color: AppColors.red, borderRadius: BorderRadius.circular(12)),
        child: const Icon(CupertinoIcons.delete, color: Color(0xFFFFFFFF)),
      ),
      onDismissed: (_) => onDelete(),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.only(bottom: 2),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: c.bg2, borderRadius: BorderRadius.circular(12)),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('⠿', style: TextStyle(fontSize: 18, color: c.fg3)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(template.label,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.fg)),
              const SizedBox(height: 3),
              Text(template.content, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, color: c.fg2)),
              if (vars.isNotEmpty) ...[
                const SizedBox(height: 5),
                Wrap(spacing: 5, children: vars.map((v) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: c.tintBg, borderRadius: BorderRadius.circular(4)),
                  child: Text(v,
                    style: TextStyle(fontFamily: 'Menlo', fontSize: 11, color: c.tint)),
                )).toList()),
              ],
            ])),
            Text('›', style: TextStyle(color: c.fg3, fontSize: 16)),
          ]),
        ),
      ),
    );
  }
}

class _TemplateFormSheet extends StatefulWidget {
  const _TemplateFormSheet({this.existing});
  final TemplateSummary? existing;

  @override
  State<_TemplateFormSheet> createState() => _TemplateFormSheetState();
}

class _TemplateFormSheetState extends State<_TemplateFormSheet> {
  late final TextEditingController _name;
  late final TextEditingController _body;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.existing?.label ?? '');
    _body = TextEditingController(text: widget.existing?.content ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _body.dispose();
    super.dispose();
  }

  void _save() {
    if (_name.text.trim().isEmpty) return;
    final id = widget.existing?.id ?? DateTime.now().millisecondsSinceEpoch.toString();
    Navigator.of(context).pop(TemplateSummary(
      id: id, label: _name.text.trim(), content: _body.text.trim()));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 32),
      decoration: BoxDecoration(
        color: c.bg2, borderRadius: const BorderRadius.vertical(top: AppRadius.lg)),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: Container(width: 36, height: 4,
          decoration: BoxDecoration(color: c.bg4, borderRadius: BorderRadius.circular(2)))),
        const SizedBox(height: 18),
        Text(widget.existing == null ? '新建模板' : '编辑模板',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: c.fg)),
        const SizedBox(height: 16),
        _Label('名称', c),
        CupertinoTextField(
          controller: _name,
          placeholder: '模板名称',
          placeholderStyle: TextStyle(color: c.fg3),
          style: TextStyle(color: c.fg),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: c.bg3, borderRadius: BorderRadius.circular(10)),
        ),
        const SizedBox(height: 14),
        _Label('文本内容', c),
        CupertinoTextField(
          controller: _body,
          placeholder: '输入模板内容，用 {变量名} 作占位符',
          placeholderStyle: TextStyle(color: c.fg3),
          style: TextStyle(color: c.fg),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: c.bg3, borderRadius: BorderRadius.circular(10)),
          maxLines: 4, minLines: 3,
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('变量占位符自动识别，发送前会弹窗填值。\n示例：帮我 review {file_path}',
            style: TextStyle(fontSize: 12, color: c.fg3, height: 1.5)),
        ),
        const SizedBox(height: 20),
        Row(children: [
          Expanded(child: CupertinoButton(
            padding: const EdgeInsets.symmetric(vertical: 13),
            color: c.bg3,
            borderRadius: BorderRadius.circular(12),
            onPressed: () => Navigator.of(context).pop(),
            child: Text('取消', style: TextStyle(color: c.fg)),
          )),
          const SizedBox(width: 10),
          Expanded(child: CupertinoButton(
            padding: const EdgeInsets.symmetric(vertical: 13),
            color: c.tint,
            borderRadius: BorderRadius.circular(12),
            onPressed: _save,
            child: const Text('保存',
              style: TextStyle(color: Color(0xFFFFFFFF), fontWeight: FontWeight.w600)),
          )),
        ]),
        if (widget.existing != null) ...[
          const SizedBox(height: 12),
          Center(child: CupertinoButton(
            padding: EdgeInsets.zero,
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('删除模板',
              style: TextStyle(color: AppColors.red, fontSize: 14)),
          )),
        ],
      ]),
    );
  }
}

Widget _Label(String text, ThemeColors c) => Padding(
  padding: const EdgeInsets.only(bottom: 5),
  child: Text(text, style: TextStyle(fontSize: 13, color: c.fg2)),
);
