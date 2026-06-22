import 'package:flutter/cupertino.dart';
import '../../models/template_summary.dart';
import '../../theme/index.dart';

class TemplateChipBar extends StatelessWidget {
  const TemplateChipBar({super.key, required this.templates, required this.onSelect});
  final List<TemplateSummary> templates;
  final ValueChanged<TemplateSummary> onSelect;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: templates.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (ctx, i) {
          final t = templates[i];
          return GestureDetector(
            onTap: () => onSelect(t),
            child: Container(
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: c.bg3,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: c.separator),
              ),
              child: Text(t.label, style: TextStyle(fontSize: 13, color: c.fg2)),
            ),
          );
        },
      ),
    );
  }
}
