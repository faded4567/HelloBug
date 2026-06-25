import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import '../../theme/index.dart';

enum _PairState { input, connecting, error }

class ManualPairPage extends StatefulWidget {
  const ManualPairPage({super.key});

  @override
  State<ManualPairPage> createState() => _ManualPairPageState();
}

class _ManualPairPageState extends State<ManualPairPage> {
  final _seg1 = TextEditingController();
  final _seg2 = TextEditingController();
  final _urlCtrl = TextEditingController();
  _PairState _state = _PairState.input;

  bool get _canConnect =>
      (_seg1.text.length == 4 && _seg2.text.length == 4) ||
      _urlCtrl.text.trim().startsWith('hellobug://');

  void _connect() {
    if (!_canConnect) return;
    setState(() { _state = _PairState.connecting; });
    // UI-only: simulate progress, real logic wired by Codex
  }

  void _reset() => setState(() { _state = _PairState.input; });

  @override
  void dispose() {
    _seg1.dispose();
    _seg2.dispose();
    _urlCtrl.dispose();
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
        leading: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: () => context.pop(),
          child: Text('配对', style: TextStyle(color: c.tint)),
        ),
        middle: Text('手动输入配对码', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: switch (_state) {
          _PairState.input   => _buildInput(c),
          _PairState.connecting => _buildConnecting(c),
          _PairState.error   => _buildError(c),
        },
      ),
    );
  }

  Widget _buildInput(ThemeColors c) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 40),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: RichText(text: TextSpan(
            style: TextStyle(fontSize: 15, color: c.fg2, height: 1.6),
            children: [
              const TextSpan(text: '在 Mac 终端运行 '),
              TextSpan(
                text: 'hellobug pair',
                style: TextStyle(fontFamily: 'Menlo', fontSize: 13,
                  backgroundColor: c.bg3, color: c.fg),
              ),
              const TextSpan(text: '，将显示的配对码输入到下方。'),
            ],
          )),
        ),

        _SectionHeader('配对码', c),
        Row(children: [
          Expanded(child: _CodeSegBox(controller: _seg1, hasFocus: true, c: c,
            onChanged: (_) => setState(() {}))),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text('·', style: TextStyle(fontSize: 20, color: c.fg3)),
          ),
          Expanded(child: _CodeSegBox(controller: _seg2, hasFocus: false, c: c,
            onChanged: (_) => setState(() {}))),
        ]),
        const SizedBox(height: 6),
        Center(child: Text('每段 4 位，共 8 位',
          style: TextStyle(fontSize: 12, color: c.fg3))),
        const SizedBox(height: 20),

        Center(child: Text('或粘贴配对链接',
          style: TextStyle(fontSize: 13, color: c.fg3))),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
          child: CupertinoTextField(
            controller: _urlCtrl,
            placeholder: 'hellobug://pair?code=XXXXXXXX',
            placeholderStyle: TextStyle(color: c.fg3, fontFamily: 'Menlo', fontSize: 13),
            style: TextStyle(color: c.fg, fontFamily: 'Menlo', fontSize: 13),
            padding: const EdgeInsets.all(14),
            decoration: null,
            onChanged: (_) => setState(() {}),
            autocorrect: false,
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4, left: 2),
          child: Text('链接通常以 hellobug:// 开头',
            style: TextStyle(fontSize: 13, color: c.fg3)),
        ),
        const SizedBox(height: 24),

        CupertinoButton(
          padding: const EdgeInsets.symmetric(vertical: 16),
          color: _canConnect ? c.tint : c.bg3,
          borderRadius: BorderRadius.circular(12),
          onPressed: _canConnect ? _connect : null,
          child: Text('连接',
            style: TextStyle(fontSize: 17,
              color: _canConnect ? const Color(0xFFFFFFFF) : c.fg3,
              fontWeight: FontWeight.w600)),
        ),
        const SizedBox(height: 10),
        Center(child: CupertinoButton(
          padding: const EdgeInsets.symmetric(vertical: 8),
          onPressed: () => context.push('/pairing/qr'),
          child: Text('📷 切换到扫码', style: TextStyle(fontSize: 15, color: c.tint)),
        )),
      ],
    );
  }

  Widget _buildConnecting(ThemeColors c) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 40),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: Text('正在连接中继服务器…',
            style: TextStyle(fontSize: 15, color: c.fg2, height: 1.6)),
        ),
        _SectionHeader('配对码', c),
        Row(children: [
          Expanded(child: _CodeSegBox(controller: _seg1, hasFocus: false, c: c)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text('·', style: TextStyle(fontSize: 20, color: c.fg3)),
          ),
          Expanded(child: _CodeSegBox(controller: _seg2, hasFocus: false, c: c)),
        ]),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(12)),
          child: Column(children: [
            const CupertinoActivityIndicator(radius: 16),
            const SizedBox(height: 12),
            Text('正在连接…',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: c.fg)),
            const SizedBox(height: 4),
            Text('relay.hellobug.dev', style: TextStyle(fontSize: 13, color: c.fg2)),
            const SizedBox(height: 16),
            ...[
              (true, '验证配对码'),
              (true, '连接中继服务器'),
              (false, '协商加密密钥'),
            ].map((e) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                SizedBox(width: 16, child: e.$1
                    ? Icon(CupertinoIcons.checkmark_alt, size: 14, color: AppColors.green)
                    : const CupertinoActivityIndicator(radius: 7)),
                const SizedBox(width: 8),
                Text(e.$2, style: TextStyle(fontSize: 13,
                  color: e.$1 ? c.fg2 : c.fg)),
              ]),
            )),
          ]),
        ),
      ],
    );
  }

  Widget _buildError(ThemeColors c) {
    return Column(children: [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        color: AppColors.red.withValues(alpha: .12),
        child: Text('配对码无效或已过期',
          style: const TextStyle(fontSize: 14, color: AppColors.red)),
      ),
      Expanded(child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 40),
        children: [
          _SectionHeader('配对码', c),
          Row(children: [
            Expanded(child: _CodeSegBox(controller: _seg1, hasFocus: false, c: c,
              hasError: true)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text('·', style: TextStyle(fontSize: 20, color: c.fg3)),
            ),
            Expanded(child: _CodeSegBox(controller: _seg2, hasFocus: false, c: c,
              hasError: true)),
          ]),
          const SizedBox(height: 6),
          Center(child: Text('配对码已过期，请重新获取',
            style: const TextStyle(fontSize: 13, color: AppColors.red))),
          const SizedBox(height: 20),
          CupertinoButton(
            padding: const EdgeInsets.symmetric(vertical: 16),
            color: c.tint,
            borderRadius: BorderRadius.circular(12),
            onPressed: _reset,
            child: const Text('重新输入',
              style: TextStyle(fontSize: 17, color: Color(0xFFFFFFFF),
                fontWeight: FontWeight.w600)),
          ),
        ],
      )),
    ]);
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label, this.c);
  final String label;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4, bottom: 8, left: 2),
    child: Text(label.toUpperCase(),
      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
        color: c.fg3, letterSpacing: .5)),
  );
}

class _CodeSegBox extends StatelessWidget {
  const _CodeSegBox({
    required this.controller,
    required this.hasFocus,
    required this.c,
    this.onChanged,
    this.hasError = false,
  });
  final TextEditingController controller;
  final bool hasFocus;
  final ThemeColors c;
  final ValueChanged<String>? onChanged;
  final bool hasError;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: hasError ? AppColors.red
              : hasFocus ? c.tint : c.separator,
          width: 2,
        ),
      ),
      child: CupertinoTextField(
        controller: controller,
        textAlign: TextAlign.center,
        style: TextStyle(fontFamily: 'Menlo', fontSize: 22,
          fontWeight: FontWeight.w700, color: c.fg, letterSpacing: 4),
        maxLength: 4,
        placeholderStyle: TextStyle(fontFamily: 'Menlo', fontSize: 22,
          color: c.fg3, letterSpacing: 4),
        placeholder: '____',
        decoration: null,
        textCapitalization: TextCapitalization.characters,
        autocorrect: false,
        onChanged: onChanged,
      ),
    );
  }
}
