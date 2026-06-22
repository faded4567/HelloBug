import 'package:flutter_riverpod/flutter_riverpod.dart';

enum AppThemeMode { dark, light, system }

final themeModeProvider =
    NotifierProvider<ThemeModeNotifier, AppThemeMode>(ThemeModeNotifier.new);

class ThemeModeNotifier extends Notifier<AppThemeMode> {
  @override
  AppThemeMode build() => AppThemeMode.system;

  void setMode(AppThemeMode mode) => state = mode;
}

final codeFontScaleProvider =
    NotifierProvider<CodeFontScaleNotifier, int>(CodeFontScaleNotifier.new);

// 0 = 13pt, 1 = 14pt, 2 = 15pt
class CodeFontScaleNotifier extends Notifier<int> {
  @override
  int build() => 0;

  void set(int scale) {
    assert(scale >= 0 && scale <= 2);
    state = scale;
  }
}
