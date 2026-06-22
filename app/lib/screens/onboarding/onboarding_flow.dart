import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';

import '../../theme/index.dart';

class OnboardingFlow extends StatefulWidget {
  const OnboardingFlow({super.key});

  @override
  State<OnboardingFlow> createState() => _OnboardingFlowState();
}

class _OnboardingFlowState extends State<OnboardingFlow> {
  int _step = 0;

  static const _steps = [_Step1(), _Step2(), _Step3()];

  void _next() {
    if (_step < _steps.length - 1) {
      setState(() => _step++);
    } else {
      context.go('/pairing');
    }
  }

  void _prev() {
    if (_step > 0) setState(() => _step--);
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      backgroundColor: context.colors.bg,
      child: SafeArea(
        child: Column(
          children: [
            Expanded(child: _steps[_step]),
            _Footer(
              step: _step,
              total: _steps.length,
              onNext: _next,
              onPrev: _step > 0 ? _prev : null,
              isLast: _step == _steps.length - 1,
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Step 1 ─────────────────────────────────────────────────────────────────

class _Step1 extends StatelessWidget {
  const _Step1();

  @override
  Widget build(BuildContext context) {
    return _ObHero(
      icon: '🤖',
      iconBg: context.colors.bg3,
      title: '随时随地\n掌控你的 AI Agent',
      body: '让 Claude Code 和 Codex 在你的本地电脑上持续工作，手机端实时跟踪进度、发指令、看结果。',
      features: const [
        _Feature(icon: '💬', iconColor: Color(0xFF0A84FF), title: '流式对话',    sub: '实时看到 agent 的思考与工具调用'),
        _Feature(icon: '📝', iconColor: Color(0xFF30D158), title: '代码 diff 预览', sub: '语法高亮、行号、hunk 快速跳转'),
        _Feature(icon: '⌨️', iconColor: Color(0xFFFF9500), title: '嵌入式终端',  sub: 'PTY 直连，移动端专属虚拟键盘'),
      ],
    );
  }
}

// ─── Step 2 ─────────────────────────────────────────────────────────────────

class _Step2 extends StatelessWidget {
  const _Step2();

  @override
  Widget build(BuildContext context) {
    return _ObHero(
      icon: '🔐',
      iconBg: context.colors.bg3,
      title: '端到端加密\n服务器看不到你的代码',
      body: '云服务器只作消息中继，数据在你的手机和电脑之间使用 Noise Protocol 全程加密，中途任何人无法窥视。',
      features: const [
        _Feature(icon: '🛡',  iconColor: Color(0xFF0A84FF), title: '双层加密',   sub: '外层 TLS 1.3 + 内层 E2EE AEAD'),
        _Feature(icon: '🔑',  iconColor: Color(0xFF30D158), title: '密钥存设备', sub: 'iOS Keychain / Android Keystore，绝不上传'),
        _Feature(icon: '🔄',  iconColor: Color(0xFFFF9500), title: '前向安全',   sub: '会话密钥定期轮换，历史不可追溯'),
      ],
    );
  }
}

// ─── Step 3 ─────────────────────────────────────────────────────────────────

class _Step3 extends StatelessWidget {
  const _Step3();

  @override
  Widget build(BuildContext context) {
    return _ObHero(
      icon: '⚠️',
      iconBg: context.colors.bg3,
      title: '危险操作\n双重守护',
      body: '执行 rm -rf、强制推送等高危命令前，HelloBug 会拦截并要求 Face ID 确认，保护你的代码安全。',
      features: const [
        _Feature(icon: '🚫', iconColor: Color(0xFFFF3B30), title: '黑名单拦截',        sub: '预置危险命令规则，可自定义'),
        _Feature(icon: '👆', iconColor: Color(0xFF0A84FF), title: 'Face ID / 指纹二次确认', sub: '生物识别后才能放行高危操作'),
        _Feature(icon: '📋', iconColor: Color(0xFF30D158), title: '本地审计日志',       sub: '所有操作记录在电脑本地，加密存储'),
      ],
    );
  }
}

// ─── Shared hero layout ──────────────────────────────────────────────────────

class _ObHero extends StatelessWidget {
  const _ObHero({
    required this.icon,
    required this.iconBg,
    required this.title,
    required this.body,
    required this.features,
  });
  final String icon;
  final Color iconBg;
  final String title;
  final String body;
  final List<_Feature> features;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      child: Column(
        children: [
          // icon with gradient ring
          Container(
            width: 96, height: 96,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: context.colors.tint.withValues(alpha: .4),
                width: 1.5,
              ),
            ),
            alignment: Alignment.center,
            child: Text(icon, style: const TextStyle(fontSize: 52)),
          ),
          const SizedBox(height: 24),
          Text(
            title,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w700,
              height: 1.25,
              color: context.colors.fg,
              letterSpacing: -.2,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            body,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, height: 1.6, color: context.colors.fg2),
          ),
          const SizedBox(height: 24),
          // feature list card
          Container(
            decoration: BoxDecoration(
              color: context.colors.bg2,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: features.indexed.map((e) {
                final (i, f) = e;
                return Column(
                  children: [
                    f,
                    if (i < features.length - 1)
                      Container(height: .5, color: context.colors.separator),
                  ],
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _Feature extends StatelessWidget {
  const _Feature({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.sub,
  });
  final String icon;
  final Color iconColor;
  final String title;
  final String sub;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
      child: Row(
        children: [
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(8),
            ),
            alignment: Alignment.center,
            child: Text(icon, style: const TextStyle(fontSize: 16)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: context.colors.fg)),
                const SizedBox(height: 1),
                Text(sub, style: TextStyle(fontSize: 13, color: context.colors.fg2)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Footer ──────────────────────────────────────────────────────────────────

class _Footer extends StatelessWidget {
  const _Footer({
    required this.step,
    required this.total,
    required this.onNext,
    required this.onPrev,
    required this.isLast,
  });
  final int step;
  final int total;
  final VoidCallback onNext;
  final VoidCallback? onPrev;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
      child: Column(
        children: [
          // progress dots
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(total, (i) {
              final active = i == step;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: active ? 20 : 8,
                height: 8,
                decoration: BoxDecoration(
                  color: active ? context.colors.tint : context.colors.fg3,
                  borderRadius: BorderRadius.circular(active ? 4 : 50),
                ),
              );
            }),
          ),
          const SizedBox(height: 16),
          CupertinoButton.filled(
            onPressed: onNext,
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: double.infinity,
              child: Text(
                isLast ? '开始配对' : '下一步',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
            ),
          ),
          if (onPrev != null) ...[
            const SizedBox(height: 8),
            CupertinoButton(
              onPressed: onPrev,
              child: Text('← 上一步',
                  style: TextStyle(fontSize: 14, color: context.colors.fg2)),
            ),
          ],
        ],
      ),
    );
  }
}
