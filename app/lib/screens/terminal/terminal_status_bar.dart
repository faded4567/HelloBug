import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class TerminalStatusBar extends StatelessWidget {
  const TerminalStatusBar({
    super.key,
    this.branch,
    this.changedFiles,
    this.workspaceName,
    this.runtimeLabel,
    this.exitCode,
  });

  final String? branch;
  final int? changedFiles;
  final String? workspaceName;
  final String? runtimeLabel;
  final int? exitCode;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final hasError = exitCode != null && exitCode != 0;

    return Container(
      height: 32,
      decoration: BoxDecoration(
        color: c.bg2,
        border: Border(top: BorderSide(color: c.separator)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Row(children: [
          if (branch != null)
            _Seg(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 7, height: 7,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: hasError ? AppColors.red : AppColors.green,
                  ),
                ),
                const SizedBox(width: 5),
                Text(branch!, style: TextStyle(fontFamily: 'Menlo',
                  fontSize: 12, color: c.tint)),
              ]),
            ),
          if (changedFiles != null)
            _Seg(child: Text(
              '⎇ $changedFiles changed',
              style: TextStyle(fontFamily: 'Menlo', fontSize: 12, color: c.fg2),
            )),
          if (workspaceName != null)
            _Seg(child: Text(
              '📁 $workspaceName',
              style: TextStyle(fontFamily: 'Menlo', fontSize: 12, color: c.fg2),
            )),
          if (hasError)
            _Seg(child: Text(
              '✕ exit $exitCode',
              style: const TextStyle(fontFamily: 'Menlo', fontSize: 12, color: AppColors.red),
            )),
          if (runtimeLabel != null && !hasError) ...[
            const Spacer(),
            _Seg(child: Text(runtimeLabel!,
              style: TextStyle(fontFamily: 'Menlo', fontSize: 12, color: c.fg2))),
          ],
          if (hasError) ...[
            const Spacer(),
            _Seg(child: Text('⚠ 1 error',
              style: const TextStyle(fontFamily: 'Menlo', fontSize: 12, color: AppColors.red))),
          ],
        ]),
      ),
    );
  }
}

class _Seg extends StatelessWidget {
  const _Seg({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
    child: child,
  );
}
