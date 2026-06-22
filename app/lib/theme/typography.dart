import 'package:flutter/cupertino.dart';

abstract final class AppTypography {
  static const fontMono = [
    'SF Mono',
    'JetBrains Mono',
    'Fira Code',
    'monospace',
  ];

  // code font sizes (13 / 14 / 15 pt, index = scale 0/1/2)
  static const codeFontSizes = [13.0, 14.0, 15.0];

  static TextStyle body({Color? color}) =>
      TextStyle(fontSize: 15, height: 1.45, color: color);

  static TextStyle bodySmall({Color? color}) =>
      TextStyle(fontSize: 13, height: 1.4, color: color);

  static TextStyle caption({Color? color}) =>
      TextStyle(fontSize: 12, color: color);

  static TextStyle micro({Color? color}) =>
      TextStyle(fontSize: 11, color: color);

  static TextStyle title({Color? color}) =>
      TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: color);

  static TextStyle titleSmall({Color? color}) =>
      TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: color);

  static TextStyle sectionHeader({Color? color}) => TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.04 * 13,
        color: color,
      );

  static TextStyle mono({double? fontSize, Color? color}) => TextStyle(
        fontFamily: 'SF Mono',
        fontFamilyFallback: const ['JetBrains Mono', 'Fira Code'],
        fontSize: fontSize ?? 13,
        height: 1.6,
        color: color,
      );
}
