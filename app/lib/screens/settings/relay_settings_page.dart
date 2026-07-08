import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';

class RelaySettingsPage extends ConsumerWidget {
  const RelaySettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final client = ref.watch(wsClientProvider);
    final connected = client != null;
    final serverUrl = client?.serverUri.toString() ?? '未连接';

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
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: connected
                      ? AppColors.green.withValues(alpha: .12)
                      : AppColors.orange.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: connected ? AppColors.green : AppColors.orange,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            connected ? '已连接' : '未连接',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: connected ? AppColors.green : AppColors.orange,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            serverUrl,
                            style: TextStyle(
                              fontSize: 12,
                              color: c.fg3,
                              fontFamily: 'SF Mono',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            CupertinoListSection.insetGrouped(
              header: Text('连接信息', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  title: const Text('服务器地址'),
                  additionalInfo: Text(
                    serverUrl,
                    style: TextStyle(fontSize: 13, color: c.fg2, fontFamily: 'SF Mono'),
                  ),
                ),
                CupertinoListTile(
                  title: const Text('连接状态'),
                  additionalInfo: Text(
                    connected ? '在线' : '离线',
                    style: TextStyle(
                      fontSize: 13,
                      color: connected ? AppColors.green : AppColors.orange,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
