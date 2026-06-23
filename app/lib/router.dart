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
import 'screens/sessions/sessions_page.dart';
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
import 'screens/terminal/terminal_page.dart';
import 'transport/ws_provider.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final hasClient = ref.read(wsClientProvider) != null;
  return GoRouter(
    initialLocation: hasClient ? '/sessions' : '/onboarding',
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
        ],
      ),
      GoRoute(path: '/unlock', builder: (_, __) => const UnlockPage()),
      GoRoute(path: '/new-session', builder: (_, __) => const NewSessionFlow()),
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
                builder: (_, __) => const SessionsPage(),
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
      GoRoute(path: '/settings/security', builder: (_, __) => const SecurityPage()),
      GoRoute(path: '/settings/notifications', builder: (_, __) => const NotificationsPage()),
      GoRoute(path: '/settings/templates', builder: (_, __) => const TemplatesPage()),
      GoRoute(path: '/settings/relay', builder: (_, __) => const RelaySettingsPage()),
      GoRoute(
        path: '/device/:id',
        builder: (_, state) => DeviceDetailPage(device: state.extra! as DeviceSummary),
      ),
      GoRoute(path: '/history', builder: (_, __) => const HistoryListPage()),
      GoRoute(
        path: '/terminal/:sessionId',
        builder:
            (_, state) =>
                TerminalPage(sessionId: state.pathParameters['sessionId']!),
      ),
    ],
  );
});
