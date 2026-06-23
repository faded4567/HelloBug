import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';
import 'slash_palette_controller.dart';

class SlashPalette extends StatelessWidget {
  const SlashPalette({super.key, required this.controller, required this.onSelect});
  final SlashPaletteController controller;
  final void Function(SlashCommand) onSelect;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final items = controller.filtered;
    if (items.isEmpty) return const SizedBox.shrink();
    return Container(
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(color: c.bg2, border: Border(top: BorderSide(color: c.separator))),
      child: ListenableBuilder(
        listenable: controller,
        builder: (_, __) {
          final cmds = controller.filtered;
          return ListView.builder(
            shrinkWrap: true,
            itemCount: cmds.length,
            itemBuilder: (_, i) {
              final cmd = cmds[i];
              return GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => onSelect(cmd),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                  child: Row(children: [
                    Text('/${cmd.name}',
                      style: TextStyle(fontSize: 14, fontFamily: 'Menlo',
                        fontWeight: FontWeight.w600, color: c.tint)),
                    const SizedBox(width: 10),
                    Expanded(child: Text(cmd.description,
                      style: TextStyle(fontSize: 13, color: c.fg2),
                      maxLines: 1, overflow: TextOverflow.ellipsis)),
                  ]),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
