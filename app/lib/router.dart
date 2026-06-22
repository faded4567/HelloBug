import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'models/session_summary.dart';
import 'screens/onboarding/onboarding_flow.dart';
import 'screens/pairing/pairing_entry_page.dart';
import 'screens/pairing/manual_pair_page.dart';
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
import 'screens/history/history_page.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/onboarding',
    debugLogDiagnostics: false,
    routes: [
      GoRoute(
        path: '/onboarding',
        builder: (_, __) => const OnboardingFlow(),
      ),
      GoRoute(
        path: '/pairing',
        builder: (_, __) => const PairingEntryPage(),
        routes: [
          GoRoute(
            path: 'manual',
            builder: (_, __) => const ManualPairPage(),
          ),
          GoRoute(
            path: 'sas',
            builder: (_, state) {
              const stub = [
                (emoji: '🐢', word: '海龟'),
                (emoji: '🪐', word: '土星'),
                (emoji: '🍵', word: '绿茶'),
                (emoji: '🎷', word: '萨克斯'),
                (emoji: '🌙', word: '月亮'),
              ];
              return const SasVerifyPage(words: stub);
            },
          ),
        ],
      ),
      GoRoute(
        path: '/unlock',
        builder: (_, __) => const UnlockPage(),
      ),
      GoRoute(
        path: '/new-session',
        builder: (_, __) => const NewSessionFlow(),
      ),
      GoRoute(
        path: '/session/:id',
        builder: (_, state) => ChatPage(
          sessionId: state.pathParameters['id']!,
          initialSession: state.extra as SessionSummary?,
        ),
      ),
      ShellRoute(
        builder: (_, __, child) => RootTabScaffold(child: child),
        routes: [
          GoRoute(
            path: '/devices',
            builder: (_, __) => const DevicesPage(),
          ),
          GoRoute(
            path: '/sessions',
            builder: (_, __) => const SessionsPage(),
          ),
          GoRoute(
            path: '/settings',
            builder: (_, __) => const SettingsHomePage(),
          ),
        ],
      ),
      GoRoute(
        path: '/diff',
        builder: (_, state) => DiffPage(args: state.extra as DiffPageArgs),
      ),
      GoRoute(
        path: '/file-tree/:sessionId',
        builder: (_, state) => FileTreePage(
          sessionId: state.pathParameters['sessionId']!,
          workspacePath: state.extra as String,
        ),
      ),
      GoRoute(
        path: '/diff-spike',
        builder: (_, __) => const DiffSpikePage(),
      ),
      GoRoute(
        path: '/settings/danger-rules',
        builder: (_, __) => const DangerRulesPage(),
      ),
      GoRoute(
        path: '/history',
        builder: (_, __) => const HistoryListPage(),
      ),
    ],
  );
});
