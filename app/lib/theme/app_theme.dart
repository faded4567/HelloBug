import 'package:flutter/cupertino.dart';
import 'tokens.dart';

abstract final class AppTheme {
  static CupertinoThemeData dark() => const CupertinoThemeData(
        brightness: Brightness.dark,
        primaryColor: AppColors.darkTint,
        scaffoldBackgroundColor: AppColors.darkBg,
        barBackgroundColor: AppColors.darkBg,
        textTheme: CupertinoTextThemeData(
          primaryColor: AppColors.darkTint,
          textStyle: TextStyle(
            color: AppColors.darkFg,
            fontFamily: '.SF Pro Text',
            fontSize: 15,
          ),
          navTitleTextStyle: TextStyle(
            color: AppColors.darkFg,
            fontFamily: '.SF Pro Display',
            fontSize: 17,
            fontWeight: FontWeight.w600,
          ),
          navActionTextStyle: TextStyle(
            color: AppColors.darkTint,
            fontFamily: '.SF Pro Text',
            fontSize: 17,
          ),
        ),
      );

  static CupertinoThemeData light() => const CupertinoThemeData(
        brightness: Brightness.light,
        primaryColor: AppColors.lightTint,
        scaffoldBackgroundColor: AppColors.lightBg,
        barBackgroundColor: AppColors.lightBg2,
        textTheme: CupertinoTextThemeData(
          primaryColor: AppColors.lightTint,
          textStyle: TextStyle(
            color: AppColors.lightFg,
            fontFamily: '.SF Pro Text',
            fontSize: 15,
          ),
          navTitleTextStyle: TextStyle(
            color: AppColors.lightFg,
            fontFamily: '.SF Pro Display',
            fontSize: 17,
            fontWeight: FontWeight.w600,
          ),
          navActionTextStyle: TextStyle(
            color: AppColors.lightTint,
            fontFamily: '.SF Pro Text',
            fontSize: 17,
          ),
        ),
      );
}

// Convenience extensions so widgets can do context.colors.bg etc.
extension AppColorsContext on BuildContext {
  ThemeColors get colors => ThemeColors(this);
}

class ThemeColors {
  const ThemeColors(this._ctx);
  final BuildContext _ctx;

  bool get _dark =>
      CupertinoTheme.brightnessOf(_ctx) == Brightness.dark;

  Color get bg        => _dark ? AppColors.darkBg        : AppColors.lightBg;
  Color get bg2       => _dark ? AppColors.darkBg2       : AppColors.lightBg2;
  Color get bg3       => _dark ? AppColors.darkBg3       : AppColors.lightBg3;
  Color get bg4       => _dark ? AppColors.darkBg4       : AppColors.lightBg4;
  Color get separator => _dark ? AppColors.darkSeparator : AppColors.lightSeparator;
  Color get fg        => _dark ? AppColors.darkFg        : AppColors.lightFg;
  Color get fg2       => _dark ? AppColors.darkFg2       : AppColors.lightFg2;
  Color get fg3       => _dark ? AppColors.darkFg3       : AppColors.lightFg3;
  Color get tint      => _dark ? AppColors.darkTint      : AppColors.lightTint;
  Color get tintBg    => _dark ? AppColors.darkTintBg    : AppColors.lightTintBg;
  Color get bubbleMe  => _dark ? AppColors.darkBubbleMe  : AppColors.lightBubbleMe;
  Color get bubbleAi  => _dark ? AppColors.darkBubbleAi  : AppColors.lightBubbleAi;
}
