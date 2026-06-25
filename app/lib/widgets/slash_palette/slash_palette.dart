import 'package:flutter/cupertino.dart';

import '../../theme/index.dart';
import 'slash_palette_controller.dart';

class SlashPalette extends StatelessWidget {
  const SlashPalette({
    super.key,
    required this.controller,
    required this.onSelect,
    this.onQueryTap,
  });

  final SlashPaletteController controller;
  final void Function(SlashCommand) onSelect;
  final VoidCallback? onQueryTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final sections = _groupCommands(controller.filtered);
        final displayQuery =
            controller.query.trim().isEmpty ? '/' : controller.query;

        Widget body;
        if (controller.loading) {
          body = Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CupertinoActivityIndicator(),
                  const SizedBox(width: 10),
                  Text(
                    '正在加载命令列表…',
                    style: TextStyle(fontSize: 14, color: c.fg3),
                  ),
                ],
              ),
            ),
          );
        } else if (controller.errorMessage != null) {
          body = Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('⚠️', style: TextStyle(fontSize: 26)),
                  const SizedBox(height: 8),
                  Text(
                    '命令列表加载失败',
                    style: TextStyle(fontSize: 14, color: c.fg2),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    controller.errorMessage!,
                    style: TextStyle(fontSize: 12, color: c.fg3),
                  ),
                  const SizedBox(height: 10),
                  CupertinoButton(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 6,
                    ),
                    color: c.tintBg,
                    minimumSize: Size.zero,
                    borderRadius: BorderRadius.circular(8),
                    onPressed: () => controller.load(force: true),
                    child: Text(
                      '重试',
                      style: TextStyle(fontSize: 14, color: c.tint),
                    ),
                  ),
                ],
              ),
            ),
          );
        } else if (controller.loaded && controller.filtered.isEmpty) {
          body = Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('🔍', style: TextStyle(fontSize: 26, color: c.fg3)),
                  const SizedBox(height: 8),
                  Text('无匹配命令', style: TextStyle(fontSize: 14, color: c.fg2)),
                  const SizedBox(height: 4),
                  Text(
                    controller.query,
                    style: TextStyle(
                      fontSize: 12,
                      color: c.fg3,
                      fontFamily: 'Menlo',
                    ),
                  ),
                ],
              ),
            ),
          );
        } else {
          var itemIndex = 0;
          body = ListView(
            padding: const EdgeInsets.only(bottom: 6),
            children: [
              for (final section in sections) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
                  child: Text(
                    section.title,
                    style: TextStyle(
                      fontSize: 12,
                      color: c.fg3,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                for (final command in section.commands)
                  _SlashCommandRow(
                    command: command,
                    active: itemIndex++ == 0,
                    onPressed: () => onSelect(command),
                  ),
              ],
            ],
          );
        }

        return Container(
          constraints: const BoxConstraints(maxHeight: 300),
          decoration: BoxDecoration(
            color: c.bg2,
            border: Border(top: BorderSide(color: c.separator)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                child: GestureDetector(
                  onTap: onQueryTap,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: c.bg,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: c.separator),
                    ),
                    child: Row(
                      children: [
                        Text(
                          '/',
                          style: TextStyle(
                            fontSize: 15,
                            color: c.tint,
                            fontFamily: 'Menlo',
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            displayQuery,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              color: c.tint,
                              fontFamily: 'Menlo',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Flexible(child: body),
            ],
          ),
        );
      },
    );
  }
}

List<_SlashSection> _groupCommands(List<SlashCommand> commands) {
  final buckets = <String, List<SlashCommand>>{};
  for (final command in commands) {
    final title = switch (command.name) {
      'clear' || 'compact' => '会话管理',
      'model' || 'permission' => '配置',
      'export' => '导出',
      _ => '工具',
    };
    buckets.putIfAbsent(title, () => <SlashCommand>[]).add(command);
  }

  const order = ['会话管理', '配置', '工具', '导出'];
  final sections = <_SlashSection>[];
  for (final title in order) {
    final items = buckets.remove(title);
    if (items != null && items.isNotEmpty) {
      sections.add(_SlashSection(title, items));
    }
  }
  for (final entry in buckets.entries) {
    if (entry.value.isNotEmpty) {
      sections.add(_SlashSection(entry.key, entry.value));
    }
  }
  return sections;
}

class _SlashSection {
  const _SlashSection(this.title, this.commands);

  final String title;
  final List<SlashCommand> commands;
}

class _SlashCommandRow extends StatelessWidget {
  const _SlashCommandRow({
    required this.command,
    required this.active,
    required this.onPressed,
  });

  final SlashCommand command;
  final bool active;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
      child: CupertinoButton(
        padding: EdgeInsets.zero,
        minimumSize: Size.zero,
        onPressed: onPressed,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: active ? c.tintBg : CupertinoColors.transparent,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              Text(
                '/${command.name}',
                style: TextStyle(
                  fontSize: 14,
                  color: c.tint,
                  fontFamily: 'Menlo',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  command.description,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 13, color: c.fg2),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
