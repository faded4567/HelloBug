import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum PairingStep { idle, connecting, waitingSas, confirming, done, error }

class PairingState {
  final PairingStep step;
  final List<String> sasEmojis;
  final String? errorMessage;

  const PairingState({
    this.step = PairingStep.idle,
    this.sasEmojis = const [],
    this.errorMessage,
  });

  PairingState copyWith({PairingStep? step, List<String>? sasEmojis, String? errorMessage}) =>
      PairingState(
        step: step ?? this.step,
        sasEmojis: sasEmojis ?? this.sasEmojis,
        errorMessage: errorMessage ?? this.errorMessage,
      );
}

class PairingController extends StateNotifier<PairingState> {
  PairingController() : super(const PairingState());

  // Called after QR scan or manual entry.
  // [qrPayload] is the raw JSON string from the QR code.
  // [manualCode] is the 6-digit string from manual input.
  // [serverUrl] is the relay server URL.
  Future<void> startFromQr(String qrPayload) async {
    try {
      final data = jsonDecode(qrPayload) as Map<String, dynamic>;
      await _start(
        pairingCode: data['pairing_code'] as String,
        serverUrl: data['server_url'] as String,
      );
    } catch (_) {
      state = state.copyWith(step: PairingStep.error, errorMessage: '二维码格式无效');
    }
  }

  Future<void> startManual(String pairingCode, String serverUrl) =>
      _start(pairingCode: pairingCode, serverUrl: serverUrl);

  Future<void> _start({required String pairingCode, required String serverUrl}) async {
    state = state.copyWith(step: PairingStep.connecting);
    // TODO(M1): wire WsClient — send device.pair, wait for device.pair.sas.
    // For now, advance to waitingSas with stub SAS words.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    state = state.copyWith(
      step: PairingStep.waitingSas,
      sasEmojis: const ['🐢', '🪐', '🍵', '🎷', '🌙'],
    );
  }

  void confirmSas(bool confirmed) {
    if (!confirmed) {
      state = state.copyWith(step: PairingStep.error, errorMessage: 'SAS 核对不一致，配对已取消');
      return;
    }
    // TODO(M1): send device.pair.confirm and wait for auth.token.
    state = state.copyWith(step: PairingStep.done);
  }

  void reset() => state = const PairingState();
}

final pairingControllerProvider =
    StateNotifierProvider.autoDispose<PairingController, PairingState>(
  (_) => PairingController(),
);
