import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

enum _RelayMode { official, selfHosted }
enum _TestResult { none, ok, fail }

class RelaySettingsPage extends StatefulWidget {
  const RelaySettingsPage({super.key});

  @override
  State<RelaySettingsPage> createState() => _RelaySettingsPageState();
}

class _RelaySettingsPageState extends State<RelaySettingsPage> {
  _RelayMode _mode = _RelayMode.official;
  _TestResult _testResult = _TestResult.none;
  bool _tls = true;
  final _hostCtrl = TextEditingController();
  final _portCtrl = TextEditingController(text: '7890');

  @override
  void dispose() {
    _hostCtrl.dispose();
    _portCtrl.dispose();
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
        middle: Text('中继服务器', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: 40),
          children: [
            CupertinoListSection.insetGrouped(
              header: Text('服务器模式', style: TextStyle(color: c.fg2)),
              children: [
                _ModeRow(
                  selected: _mode == _RelayMode.official,
                  title: '官方服务器',
                  subtitle: 'relay.hellobug.dev',
                  badge: '推荐',
                  onTap: () => setState(() { _mode = _RelayMode.official; _testResult = _TestResult.none; }),
                ),
                _ModeRow(
                  selected: _mode == _RelayMode.selfHosted,
                  title: '自托管服务器',
                  subtitle: '自定义地址和端口',
                  onTap: () => setState(() { _mode = _RelayMode.selfHosted; _testResult = _TestResult.none; }),
                ),
              ],
            ),

            if (_mode == _RelayMode.official) ...[
              CupertinoListSection.insetGrouped(
                header: Text('当前状态', style: TextStyle(color: c.fg2)),
                children: [
                  CupertinoListTile(title: const Text('地址'),
                    additionalInfo: const Text('relay.hellobug.dev',
                      style: TextStyle(fontFamily: 'Menlo', fontSize: 13))),
                  CupertinoListTile(title: const Text('端口'),
                    additionalInfo: const Text('443',
                      style: TextStyle(fontFamily: 'Menlo', fontSize: 13))),
                  CupertinoListTile(
                    title: const Text('TLS'),
                    additionalInfo: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.green.withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Text('启用',
                        style: TextStyle(fontSize: 11, color: AppColors.green, fontWeight: FontWeight.w600)),
                    ),
                  ),
                  CupertinoListTile(
                    title: const Text('连接状态'),
                    additionalInfo: Row(mainAxisSize: MainAxisSize.min, children: [
                      Container(width: 8, height: 8,
                        decoration: const BoxDecoration(color: AppColors.green, shape: BoxShape.circle)),
                      const SizedBox(width: 6),
                      const Text('已连接', style: TextStyle(color: AppColors.green, fontSize: 14)),
                    ]),
                  ),
                  CupertinoListTile(title: const Text('延迟'),
                    additionalInfo: Text('28 ms', style: TextStyle(color: c.fg2))),
                ],
              ),
              CupertinoListSection.insetGrouped(
                children: [
                  CupertinoListTile(
                    title: Center(child: Text('测试连接', style: TextStyle(color: c.tint))),
                    onTap: () {},
                  ),
                ],
              ),
            ],

            if (_mode == _RelayMode.selfHosted) ...[
              CupertinoListSection.insetGrouped(
                header: Text('服务器地址', style: TextStyle(color: c.fg2)),
                children: [
                  CupertinoListTile(
                    title: const Text('主机'),
                    trailing: SizedBox(
                      width: 200,
                      child: CupertinoTextField(
                        controller: _hostCtrl,
                        placeholder: 'my-relay.example.com',
                        textAlign: TextAlign.right,
                        style: TextStyle(fontFamily: 'Menlo', fontSize: 14, color: c.fg),
                        placeholderStyle: TextStyle(color: c.fg3, fontFamily: 'Menlo', fontSize: 14),
                        decoration: null,
                        autocorrect: false,
                      ),
                    ),
                  ),
                  CupertinoListTile(
                    title: const Text('端口'),
                    trailing: SizedBox(
                      width: 70,
                      child: CupertinoTextField(
                        controller: _portCtrl,
                        textAlign: TextAlign.right,
                        keyboardType: TextInputType.number,
                        style: TextStyle(fontFamily: 'Menlo', fontSize: 14, color: c.fg),
                        decoration: null,
                      ),
                    ),
                  ),
                  CupertinoListTile(
                    title: const Text('TLS'),
                    trailing: CupertinoSwitch(
                      value: _tls,
                      onChanged: (v) => setState(() => _tls = v),
                      activeTrackColor: c.tint,
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Text('建议保持 TLS 开启以确保传输安全',
                  style: TextStyle(fontSize: 12, color: c.fg3)),
              ),
              if (_testResult == _TestResult.ok)
                Container(
                  margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.green.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(10),
                    border: Border(left: BorderSide(color: AppColors.green, width: 3)),
                  ),
                  child: const Text('✓ 连接成功 · 延迟 42 ms',
                    style: TextStyle(color: AppColors.green)),
                ),
              if (_testResult == _TestResult.fail)
                Container(
                  margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.red.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(10),
                    border: Border(left: BorderSide(color: AppColors.red, width: 3)),
                  ),
                  child: const Text('✕ 连接失败，请检查地址和端口',
                    style: TextStyle(color: AppColors.red)),
                ),
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: CupertinoButton(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  color: c.tint,
                  borderRadius: BorderRadius.circular(12),
                  onPressed: () {},
                  child: const Text('应用并重连',
                    style: TextStyle(color: Color(0xFFFFFFFF), fontWeight: FontWeight.w600)),
                ),
              ),
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: CupertinoButton(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(12),
                  onPressed: () => setState(() => _testResult = _TestResult.ok),
                  child: Text('测试连接', style: TextStyle(color: c.fg)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ModeRow extends StatelessWidget {
  const _ModeRow({
    required this.selected,
    required this.title,
    required this.subtitle,
    this.badge,
    required this.onTap,
  });
  final bool selected;
  final String title, subtitle;
  final String? badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoListTile(
      onTap: onTap,
      leading: Container(
        width: 20, height: 20,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(
            color: selected ? c.tint : c.separator,
            width: 2,
          ),
        ),
        alignment: Alignment.center,
        child: selected
            ? Container(width: 10, height: 10,
                decoration: BoxDecoration(shape: BoxShape.circle, color: c.tint))
            : null,
      ),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: badge != null
          ? Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.green.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(badge!,
                style: const TextStyle(fontSize: 11, color: AppColors.green,
                  fontWeight: FontWeight.w600)),
            )
          : null,
    );
  }
}
