import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/template_summary.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import '../../models/inner_message.dart';
import '../../state/chat_provider.dart';
import '../../widgets/template_chip_bar.dart';

class ChatInputBar extends ConsumerStatefulWidget {
  const ChatInputBar({super.key, required this.sessionId});
  final String sessionId;

  @override
  ConsumerState<ChatInputBar> createState() => _ChatInputBarState();
}

class _ChatInputBarState extends ConsumerState<ChatInputBar> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  bool _hasText = false;

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    _ctrl.clear();
    setState(() => _hasText = false);
    ref.read(chatProvider.notifier).addUserMessage(widget.sessionId, text);
    final client = ref.read(wsClientProvider);
    await client?.send(InnerMessage.create('session.input', {
      'session_id': widget.sessionId,
      'text': text,
    }));
  }

  void _insertTemplate(TemplateSummary t) {
    _ctrl.text = t.content;
    _ctrl.selection = TextSelection.collapsed(offset: t.content.length);
    _hasText = true;
    _focus.requestFocus();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final canSend = _hasText && ref.watch(wsClientProvider) != null;

    return Container(
      color: c.bg,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(height: 1, color: c.separator),
        TemplateChipBar(templates: kDefaultTemplates, onSelect: _insertTemplate),
        Container(height: 1, color: c.separator),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(
              child: CupertinoTextField(
                controller: _ctrl,
                focusNode: _focus,
                placeholder: '发消息给 Agent…',
                placeholderStyle: TextStyle(color: c.fg3),
                style: TextStyle(color: c.fg, fontSize: 15),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(20),
                ),
                maxLines: 6,
                minLines: 1,
                onChanged: (v) => setState(() => _hasText = v.trim().isNotEmpty),
                textInputAction: TextInputAction.newline,
              ),
            ),
            const SizedBox(width: 6),
            CupertinoButton(
              padding: const EdgeInsets.all(4),
              onPressed: canSend ? _send : null,
              child: Container(
                width: 36, height: 36,
                decoration: BoxDecoration(
                  color: canSend ? c.tint : c.bg3,
                  shape: BoxShape.circle,
                ),
                child: Icon(CupertinoIcons.arrow_up, size: 18,
                  color: canSend ? const Color(0xFFFFFFFF) : c.fg3),
              ),
            ),
          ]),
        ),
        SizedBox(height: MediaQuery.of(context).padding.bottom > 0 ? 4 : 8),
      ]),
    );
  }
}
