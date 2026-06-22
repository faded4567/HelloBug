import 'package:flutter/cupertino.dart';

// Design tokens extracted from wireframes/_common.css
abstract final class AppColors {
  // status (theme-independent)
  static const green  = Color(0xFF34C759);
  static const red    = Color(0xFFFF3B30);
  static const orange = Color(0xFFFF9500);
  static const blue   = Color(0xFF007AFF);
  static const gray50 = Color(0xFF8E8E93);

  // diff
  static const delBg  = Color(0x26FF3B30); // rgba(255,59,48,.15)
  static const delFg  = Color(0xFFFF453A);
  static const addBg  = Color(0x21349F59); // rgba(52,199,89,.13)
  static const addFg  = Color(0xFF30D158);

  // --- dark ---
  static const darkBg        = Color(0xFF000000);
  static const darkBg2       = Color(0xFF1C1C1E);
  static const darkBg3       = Color(0xFF2C2C2E);
  static const darkBg4       = Color(0xFF3A3A3C);
  static const darkSeparator = Color(0x14FFFFFF); // rgba(255,255,255,.08)
  static const darkFg        = Color(0xFFFFFFFF);
  static const darkFg2       = Color(0x99FFFFFF); // .60
  static const darkFg3       = Color(0x59FFFFFF); // .35
  static const darkTint      = Color(0xFF0A84FF);
  static const darkTintBg    = Color(0x260A84FF); // .15
  static const darkBubbleMe  = Color(0xFF0A84FF);
  static const darkBubbleAi  = Color(0xFF2C2C2E);

  // --- light ---
  static const lightBg        = Color(0xFFF2F2F7);
  static const lightBg2       = Color(0xFFFFFFFF);
  static const lightBg3       = Color(0xFFF2F2F7);
  static const lightBg4       = Color(0xFFE5E5EA);
  static const lightSeparator = Color(0x14000000); // rgba(0,0,0,.08)
  static const lightFg        = Color(0xFF000000);
  static const lightFg2       = Color(0x8C000000); // .55
  static const lightFg3       = Color(0x4D000000); // .30
  static const lightTint      = Color(0xFF007AFF);
  static const lightTintBg    = Color(0x1A007AFF); // .10
  static const lightBubbleMe  = Color(0xFF007AFF);
  static const lightBubbleAi  = Color(0xFFE9E9EB);
}

abstract final class AppSpacing {
  static const sp1 = 4.0;
  static const sp2 = 8.0;
  static const sp3 = 12.0;
  static const sp4 = 16.0;
  static const sp5 = 20.0;
  static const sp6 = 24.0;
}

abstract final class AppRadius {
  static const sm   = Radius.circular(8);
  static const md   = Radius.circular(12);
  static const lg   = Radius.circular(18);
  static const pill = Radius.circular(999);
}
