import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../crypto/secure_store.dart';

enum DiffViewMode { unified, split }

class AppSettings {
  const AppSettings({
    this.lockTimeoutMinutes = 5,
    this.biometric = true,
    this.screenshotBlocked = true,
    this.clipboardProtect = true,
    this.pushEnabled = true,
    this.agentDone = true,
    this.dangerWait = true,
    this.agentError = true,
    this.agentInput = true,
    this.deviceOnline = false,
    this.tokenAlert = false,
    this.hideDetails = true,
    this.dnd = true,
    this.dangerRules = const [],
    this.codeFontScale = 1.0,
    this.diffViewMode = DiffViewMode.unified,
  });
  final int lockTimeoutMinutes;
  final bool biometric;
  final bool screenshotBlocked;
  final bool clipboardProtect;
  final bool pushEnabled;
  final bool agentDone;
  final bool dangerWait;
  final bool agentError;
  final bool agentInput;
  final bool deviceOnline;
  final bool tokenAlert;
  final bool hideDetails;
  final bool dnd;
  final List<DangerRule> dangerRules;
  final double codeFontScale;
  final DiffViewMode diffViewMode;

  AppSettings copyWith({
    int? lockTimeoutMinutes,
    bool? biometric,
    bool? screenshotBlocked,
    bool? clipboardProtect,
    bool? pushEnabled,
    bool? agentDone,
    bool? dangerWait,
    bool? agentError,
    bool? agentInput,
    bool? deviceOnline,
    bool? tokenAlert,
    bool? hideDetails,
    bool? dnd,
    List<DangerRule>? dangerRules,
    double? codeFontScale,
    DiffViewMode? diffViewMode,
  }) =>
      AppSettings(
        lockTimeoutMinutes: lockTimeoutMinutes ?? this.lockTimeoutMinutes,
        biometric: biometric ?? this.biometric,
        screenshotBlocked: screenshotBlocked ?? this.screenshotBlocked,
        clipboardProtect: clipboardProtect ?? this.clipboardProtect,
        pushEnabled: pushEnabled ?? this.pushEnabled,
        agentDone: agentDone ?? this.agentDone,
        dangerWait: dangerWait ?? this.dangerWait,
        agentError: agentError ?? this.agentError,
        agentInput: agentInput ?? this.agentInput,
        deviceOnline: deviceOnline ?? this.deviceOnline,
        tokenAlert: tokenAlert ?? this.tokenAlert,
        hideDetails: hideDetails ?? this.hideDetails,
        dnd: dnd ?? this.dnd,
        dangerRules: dangerRules ?? this.dangerRules,
        codeFontScale: codeFontScale ?? this.codeFontScale,
        diffViewMode: diffViewMode ?? this.diffViewMode,
      );

  Map<String, dynamic> toJson() => {
    'lockTimeoutMinutes': lockTimeoutMinutes,
    'biometric': biometric,
    'screenshotBlocked': screenshotBlocked,
    'clipboardProtect': clipboardProtect,
    'pushEnabled': pushEnabled,
    'agentDone': agentDone,
    'dangerWait': dangerWait,
    'agentError': agentError,
    'agentInput': agentInput,
    'deviceOnline': deviceOnline,
    'tokenAlert': tokenAlert,
    'hideDetails': hideDetails,
    'dnd': dnd,
    'codeFontScale': codeFontScale,
    'diffViewMode': diffViewMode.name,
  };

  factory AppSettings.fromJson(Map<String, dynamic> json) => AppSettings(
    lockTimeoutMinutes: (json['lockTimeoutMinutes'] as num?)?.toInt() ?? 5,
    biometric: json['biometric'] as bool? ?? true,
    screenshotBlocked: json['screenshotBlocked'] as bool? ?? true,
    clipboardProtect: json['clipboardProtect'] as bool? ?? true,
    pushEnabled: json['pushEnabled'] as bool? ?? true,
    agentDone: json['agentDone'] as bool? ?? true,
    dangerWait: json['dangerWait'] as bool? ?? true,
    agentError: json['agentError'] as bool? ?? true,
    agentInput: json['agentInput'] as bool? ?? true,
    deviceOnline: json['deviceOnline'] as bool? ?? false,
    tokenAlert: json['tokenAlert'] as bool? ?? false,
    hideDetails: json['hideDetails'] as bool? ?? true,
    dnd: json['dnd'] as bool? ?? true,
    codeFontScale: (json['codeFontScale'] as num?)?.toDouble() ?? 1.0,
    diffViewMode: DiffViewMode.values.firstWhere(
      (e) => e.name == json['diffViewMode'],
      orElse: () => DiffViewMode.unified,
    ),
  );
}

class DangerRule {
  const DangerRule({required this.id, required this.pattern, required this.description, this.enabled = true});
  final String id;
  final String pattern;
  final String description;
  final bool enabled;
}

final settingsProvider =
    NotifierProvider<SettingsNotifier, AppSettings>(SettingsNotifier.new);

class SettingsNotifier extends Notifier<AppSettings> {
  static const _storeKey = 'hellobug_settings';

  @override
  AppSettings build() {
    _restore();
    return const AppSettings();
  }

  void update(AppSettings Function(AppSettings) fn) {
    state = fn(state);
    _persist();
  }

  Future<void> _restore() async {
    try {
      final raw = await SecureStore.read(_storeKey);
      if (raw != null) {
        state = AppSettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      }
    } catch (_) {}
  }

  Future<void> _persist() async {
    try {
      await SecureStore.write(_storeKey, jsonEncode(state.toJson()));
    } catch (_) {}
  }
}
