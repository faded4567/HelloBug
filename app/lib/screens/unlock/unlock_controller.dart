import 'package:flutter_riverpod/flutter_riverpod.dart';

class UnlockController extends StateNotifier<bool> {
  UnlockController() : super(true); // starts locked

  void unlock() => state = false;
  void lock()   => state = true;
}

final unlockControllerProvider =
    StateNotifierProvider<UnlockController, bool>((_) => UnlockController());
