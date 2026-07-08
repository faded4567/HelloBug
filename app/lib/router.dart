import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'models/session_summary.dart';
import 'screens/onboarding/onboarding_flow.dart';
import 'screens/pairing/pairing_entry_page.dart';
import 'screens/pairing/manual_pair_page.dart';
import 'screens/pairing/qr_scan_page.dart';
import 'screens/pairing/sas_verify_page.dart';
import 'screens/unlock/unlock_page.dart';
import 'screens/root_tab_scaffold.dart';
import 'screens/devices/devices_page.dart';
import 'screens/workspace_home_page.dart';
import 'screens/workspace_permission_page.dart';
import 'screens/workspace_path_invalid_page.dart';
import 'screens/workspace_empty_page.dart';
import 'screens/workspace_new_page.dart';
import 'screens/workspace_settings_page.dart';
import 'screens/push_landing_page.dart';
import 'screens/settings/settings_home_page.dart';
import 'screens/diff_spike/diff_spike_page.dart';
import 'screens/diff/diff_page.dart';
import 'screens/filetree/file_tree_page.dart';
import 'screens/new_session/new_session_flow.dart';
import 'screens/chat/chat_page.dart';
import 'screens/settings/danger_rules_page.dart';
import 'screens/settings/appearance_page.dart';
import 'screens/settings/about_page.dart';
import 'screens/settings/security_page.dart';
import 'screens/settings/notifications_page.dart';
import 'screens/settings/templates_page.dart';
import 'screens/settings/relay_settings_page.dart';
import 'screens/devices/device_detail_page.dart';
import 'models/device_summary.dart';
import 'screens/history/history_page.dart';
import 'screens/auth_invalid_page.dart';
import 'screens/startup_loading_page.dart';
import 'screens/device_revoked_page.dart';
import 'screens/pairing/pairing_expired_page.dart';
import 'screens/pairing/pairing_failed_page.dart';
import 'screens/terminal/terminal_page.dart';
import 'transport/ws_provider.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final hasClient = ref.read(wsClientProvider) != null;
  const debugInitialRoute = String.fromEnvironment(
    'HELLOBUG_DEBUG_INITIAL_ROUTE',
    defaultValue: '',
  );
  return GoRouter(
    initialLocation:
        debugInitialRoute.isNotEmpty
            ? debugInitialRoute
            : hasClient
            ? '/sessions'
            : '/onboarding',
    debugLogDiagnostics: false,
    routes: [
      GoRoute(path: '/onboarding', builder: (_, __) => const OnboardingFlow()),
      GoRoute(
        path: '/pairing',
        builder: (_, __) => const PairingEntryPage(),
        routes: [
          GoRoute(path: 'manual', builder: (_, __) => const ManualPairPage()),
          GoRoute(path: 'qr', builder: (_, __) => const QrScanPage()),
          GoRoute(path: 'sas', builder: (_, __) => const SasVerifyPage()),
          GoRoute(
            path: 'expired',
            builder: (_, state) {
              final extra = state.extra;
              if (extra is Map<String, String>) {
                return PairingExpiredPage(
                  expiredCode: extra['expiredCode'],
                  renewCommand: extra['renewCommand'] ?? 'hellobug pair --renew',
                );
              }
              return const PairingExpiredPage();
            },
          ),
          GoRoute(
            path: 'failed',
            builder: (_, state) {
              final extra = state.extra;
              if (extra is Map<String, String>) {
                return PairingFailedPage(
                  errorMessage: extra['errorMessage'] ?? '配对失败',
                  errorCode: extra['errorCode'],
                  serverUrl: extra['serverUrl'],
                );
              }
              return const PairingFailedPage(errorMessage: '配对失败');
            },
          ),
        ],
      ),
      GoRoute(path: '/unlock', builder: (_, __) => const UnlockPage()),
      GoRoute(
        path: '/startup-loading',
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map<String, dynamic>) {
            return StartupLoadingPage(
              relayUrl: extra['relayUrl'] as String?,
              pairedDeviceName: extra['pairedDeviceName'] as String?,
              lastActiveText: extra['lastActiveText'] as String?,
              error: extra['error'] as String?,
              onRetry: extra['onRetry'] as VoidCallback?,
              onEnterOffline: extra['onEnterOffline'] as VoidCallback?,
              onGoToOnboarding: extra['onGoToOnboarding'] as VoidCallback?,
            );
          }
          return const StartupLoadingPage();
        },
      ),
      GoRoute(
        path: '/device-revoked',
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map<String, String>) {
            return DeviceRevokedPage(
              deviceName: extra['deviceName'],
              revokedAt: extra['revokedAt'],
              revokedBy: extra['revokedBy'],
            );
          }
          return const DeviceRevokedPage();
        },
      ),
      GoRoute(
        path: '/auth-invalid',
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map<String, String>) {
            return AuthInvalidPage(
              deviceName: extra['deviceName'],
              lastActiveText: extra['lastActiveText'],
            );
          }
          return const AuthInvalidPage();
        },
      ),
      GoRoute(
        path: '/new-session',
        builder:
            (_, state) => NewSessionFlow(
              initialArgs:
                  state.extra is NewSessionFlowArgs
                      ? state.extra! as NewSessionFlowArgs
                      : null,
            ),
      ),
      GoRoute(
        path: '/session/:id',
        builder:
            (_, state) => ChatPage(
              sessionId: state.pathParameters['id']!,
              initialSession: state.extra as SessionSummary?,
            ),
      ),
      StatefulShellRoute.indexedStack(
        builder:
            (_, __, navigationShell) =>
                RootTabScaffold(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/sessions',
                builder: (_, __) => const WorkspaceHomePage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (_, __) => const SettingsHomePage(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/diff',
        builder: (_, state) => DiffPage(args: state.extra as DiffPageArgs),
      ),
      GoRoute(
        path: '/file-tree/:sessionId',
        builder:
            (_, state) => FileTreePage(
              sessionId: state.pathParameters['sessionId']!,
              workspacePath: state.extra as String,
            ),
      ),
      GoRoute(path: '/diff-spike', builder: (_, __) => const DiffSpikePage()),
      GoRoute(path: '/devices', builder: (_, __) => const DevicesPage()),
      GoRoute(
        path: '/settings/danger-rules',
        builder: (_, __) => const DangerRulesPage(),
      ),
      GoRoute(
        path: '/settings/appearance',
        builder: (_, __) => const AppearancePage(),
      ),
      GoRoute(path: '/settings/about', builder: (_, __) => const AboutPage()),
      GoRoute(
        path: '/settings/security',
        builder: (_, __) => const SecurityPage(),
      ),
      GoRoute(
        path: '/settings/notifications',
        builder: (_, __) => const NotificationsPage(),
      ),
      GoRoute(
        path: '/settings/templates',
        builder: (_, __) => const TemplatesPage(),
      ),
      GoRoute(
        path: '/settings/relay',
        builder: (_, __) => const RelaySettingsPage(),
      ),
      GoRoute(
        path: '/device/:id',
        builder:
            (_, state) => DeviceDetailPage(
              deviceId: state.pathParameters['id']!,
              initialDevice:
                  state.extra is DeviceSummary
                      ? state.extra! as DeviceSummary
                      : null,
            ),
      ),
      GoRoute(path: '/history', builder: (_, __) => const HistoryListPage()),
      GoRoute(
        path: '/push-landing',
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map<String, dynamic>) {
            return PushLandingPage(
              message: extra['message'] as String?,
              sessionId: extra['sessionId'] as String?,
            );
          }
          return const PushLandingPage();
        },
      ),
      GoRoute(
        path: '/workspace/settings',
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map<String, dynamic>) {
            return WorkspaceSettingsPage(
              workspacePath: extra['workspacePath'] as String? ?? '',
              workspaceName: extra['workspaceName'] as String?,
              deviceName: extra['deviceName'] as String?,
            );
          }
          return const WorkspaceSettingsPage(workspacePath: '');
        },
      ),
      GoRoute(
        path: '/workspace/empty',
        builder: (_, __) => const WorkspaceEmptyPage(),
      ),
      GoRoute(
        path: '/workspace/new',
        builder: (_, __) => const WorkspaceNewPage(),
      ),
      GoRoute(
        path: '/workspace/path-invalid',
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map<String, dynamic>) {
            return WorkspacePathInvalidPage(
              workspacePath: extra['workspacePath'] as String? ?? '',
              repairHint: extra['repairHint'] as String?,
            );
          }
          return const WorkspacePathInvalidPage(workspacePath: '');
        },
      ),
      GoRoute(
        path: '/workspace/permission',
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map<String, dynamic>) {
            return WorkspacePermissionPage(
              workspacePath: extra['workspacePath'] as String? ?? '',
              currentPermission: extra['currentPermission'] as String?,
              requiredPermission: extra['requiredPermission'] as String?,
              fixCommand: extra['fixCommand'] as String?,
              isFullyDenied: (extra['isFullyDenied'] as bool?) ?? false,
              repairHints: (extra['repairHints'] as List?)?.cast<String>(),
            );
          }
          return const WorkspacePermissionPage(workspacePath: '');
        },
      ),
      GoRoute(
        path: '/terminal/:sessionId',
        builder:
            (_, state) => TerminalPage(
              sessionId: state.pathParameters['sessionId']!,
              initialSession:
                  state.extra is SessionSummary
                      ? state.extra! as SessionSummary
                      : null,
            ),
      ),
    ],
  );
});
