import 'package:flutter_riverpod/flutter_riverpod.dart';

class AppSettings {
  const AppSettings({
    this.lockTimeoutMinutes = 5,
    this.pushEnabled = true,
    this.screenshotBlocked = true,
    this.dangerRules = const [],
  });
  final int lockTimeoutMinutes;
  final bool pushEnabled;
  final bool screenshotBlocked;
  final List<DangerRule> dangerRules;

  AppSettings copyWith({
    int? lockTimeoutMinutes,
    bool? pushEnabled,
    bool? screenshotBlocked,
    List<DangerRule>? dangerRules,
  }) =>
      AppSettings(
        lockTimeoutMinutes: lockTimeoutMinutes ?? this.lockTimeoutMinutes,
        pushEnabled: pushEnabled ?? this.pushEnabled,
        screenshotBlocked: screenshotBlocked ?? this.screenshotBlocked,
        dangerRules: dangerRules ?? this.dangerRules,
      );
}

class DangerRule {
  const DangerRule({required this.id, required this.pattern, required this.description, this.enabled = true});
  final String id;
  final String pattern; // regex
  final String description;
  final bool enabled;
}

final settingsProvider =
    NotifierProvider<SettingsNotifier, AppSettings>(SettingsNotifier.new);

class SettingsNotifier extends Notifier<AppSettings> {
  @override
  AppSettings build() => const AppSettings();

  void update(AppSettings Function(AppSettings) fn) => state = fn(state);
}
