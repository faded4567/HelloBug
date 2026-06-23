import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

enum _TriggerType { keyword, regex, toolType }
enum _ActionType { autoReject, confirm, notifyOnly }

class DangerRuleFormSheet extends StatefulWidget {
  const DangerRuleFormSheet({super.key, this.initialName, this.initialPattern});
  final String? initialName;
  final String? initialPattern;

  static Future<void> show(BuildContext context,
      {String? initialName, String? initialPattern}) =>
      showCupertinoModalPopup<void>(
        context: context,
        builder: (_) => DangerRuleFormSheet(
          initialName: initialName, initialPattern: initialPattern),
      );

  @override
  State<DangerRuleFormSheet> createState() => _DangerRuleFormSheetState();
}

class _DangerRuleFormSheetState extends State<DangerRuleFormSheet> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _patternCtrl;
  _TriggerType _trigger = _TriggerType.keyword;
  _ActionType _action = _ActionType.autoReject;
  bool _globalScope = true;
  bool _bashOnly = false;
  bool _writeOnly = false;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.initialName ?? '');
    _patternCtrl = TextEditingController(text: widget.initialPattern ?? '');
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _patternCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final isEdit = widget.initialName != null;
    return Container(
      height: MediaQuery.of(context).size.height * .90,
      decoration: BoxDecoration(
        color: c.bg, borderRadius: const BorderRadius.vertical(top: AppRadius.lg)),
      child: Column(children: [
        // nav bar
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
          child: Row(children: [
            CupertinoButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('取消', style: TextStyle(color: c.tint)),
            ),
            Expanded(child: Text(isEdit ? '编辑规则' : '新建规则',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.fg))),
            CupertinoButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('保存',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tint)),
            ),
          ]),
        ),

        Expanded(child: ListView(
          padding: const EdgeInsets.only(bottom: 40),
          children: [
            _Section('规则名称', c),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
              child: CupertinoTextField(
                controller: _nameCtrl,
                placeholder: '例：禁止递归删除',
                placeholderStyle: TextStyle(color: c.fg3),
                style: TextStyle(fontSize: 16, color: c.fg),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
                decoration: null,
              ),
            ),

            _Section('触发方式', c),
            _RadioGroup(c: c, children: [
              _RadioRow('🔍', '关键词匹配',
                _trigger == _TriggerType.keyword, c,
                () => setState(() => _trigger = _TriggerType.keyword)),
              _RadioRow('⚡', '正则表达式',
                _trigger == _TriggerType.regex, c,
                () => setState(() => _trigger = _TriggerType.regex)),
              _RadioRow('🤖', '工具类型',
                _trigger == _TriggerType.toolType, c,
                () => setState(() => _trigger = _TriggerType.toolType),
                last: true),
            ]),

            _Section('匹配模式', c),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_trigger == _TriggerType.keyword
                    ? '关键词（每行一个）'
                    : _trigger == _TriggerType.regex
                        ? '正则表达式'
                        : '工具类型',
                  style: TextStyle(fontSize: 14, color: c.fg2)),
                const SizedBox(height: 4),
                CupertinoTextField(
                  controller: _patternCtrl,
                  placeholder: _trigger == _TriggerType.keyword
                      ? 'rm -rf\nsudo rm' : r'rm\s+-rf|DROP\s+TABLE',
                  placeholderStyle: TextStyle(color: c.fg3, fontFamily: 'Menlo', fontSize: 14),
                  style: TextStyle(fontFamily: 'Menlo', fontSize: 15, color: c.fg),
                  maxLines: 4, minLines: 3,
                  decoration: null,
                ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 16, 0),
              child: Text('命令或文件路径中包含以上任意关键词时触发。',
                style: TextStyle(fontSize: 13, color: c.fg3, height: 1.5)),
            ),

            _Section('命中时的动作', c),
            _RadioGroup(c: c, children: [
              _RadioRow('🚫', '自动拒绝',
                _action == _ActionType.autoReject, c,
                () => setState(() => _action = _ActionType.autoReject)),
              _RadioRow('⚠️', '弹出确认',
                _action == _ActionType.confirm, c,
                () => setState(() => _action = _ActionType.confirm)),
              _RadioRow('📢', '仅通知',
                _action == _ActionType.notifyOnly, c,
                () => setState(() => _action = _ActionType.notifyOnly),
                last: true),
            ]),

            _Section('适用范围', c),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
              child: Column(children: [
                _ToggleRow('全局（所有工作区）', _globalScope, c,
                  (v) => setState(() => _globalScope = v)),
                _ToggleRow('仅 Bash 工具', _bashOnly, c,
                  (v) => setState(() => _bashOnly = v)),
                _ToggleRow('仅 WriteFile 工具', _writeOnly, c,
                  (v) => setState(() => _writeOnly = v), last: true),
              ]),
            ),

            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: CupertinoButton(
                padding: const EdgeInsets.symmetric(vertical: 14),
                color: c.bg2,
                borderRadius: BorderRadius.circular(12),
                onPressed: () {},
                child: Text('🧪 测试规则匹配', style: TextStyle(fontSize: 15, color: c.fg)),
              ),
            ),

            if (isEdit) ...[
              const SizedBox(height: 8),
              Center(child: CupertinoButton(
                padding: const EdgeInsets.symmetric(vertical: 8),
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('删除此规则',
                  style: TextStyle(color: AppColors.red, fontSize: 15)),
              )),
            ],
          ],
        )),
      ]),
    );
  }
}

Widget _Section(String text, ThemeColors c) => Padding(
  padding: const EdgeInsets.fromLTRB(20, 20, 20, 6),
  child: Text(text.toUpperCase(),
    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
      color: c.fg3, letterSpacing: .5)),
);

Widget _RadioRow(String icon, String label, bool selected, ThemeColors c,
    VoidCallback onTap, {bool last = false}) =>
  GestureDetector(
    onTap: onTap,
    behavior: HitTestBehavior.opaque,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        border: last ? null : Border(
          bottom: BorderSide(color: c.separator))),
      child: Row(children: [
        Text(icon, style: const TextStyle(fontSize: 20)),
        const SizedBox(width: 14),
        Expanded(child: Text(label, style: TextStyle(fontSize: 15, color: c.fg))),
        Container(
          width: 20, height: 20,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: selected ? c.tint : null,
            border: Border.all(color: selected ? c.tint : c.bg4, width: 2),
          ),
          alignment: Alignment.center,
          child: selected ? const Text('✓',
            style: TextStyle(color: Color(0xFFFFFFFF), fontSize: 12)) : null,
        ),
      ]),
    ),
  );

class _RadioGroup extends StatelessWidget {
  const _RadioGroup({required this.c, required this.children});
  final ThemeColors c;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.symmetric(horizontal: 16),
    decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
    child: Column(children: children),
  );
}

Widget _ToggleRow(String label, bool value, ThemeColors c,
    ValueChanged<bool> onChanged, {bool last = false}) =>
  Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    decoration: BoxDecoration(
      border: last ? null : Border(bottom: BorderSide(color: c.separator))),
    child: Row(children: [
      Expanded(child: Text(label, style: TextStyle(fontSize: 15, color: c.fg))),
      CupertinoSwitch(value: value, onChanged: onChanged, activeTrackColor: c.tint),
    ]),
  );
