import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../crypto/keys.dart';
import '../../models/inner_message.dart';
import '../../transport/app_runtime_store.dart';
import '../../transport/ws_client.dart';
import '../../transport/ws_provider.dart';

const _pairingUnset = Object();

enum PairingStep { idle, connecting, waitingSas, confirming, done, error }

class PairingState {
  const PairingState({
    this.step = PairingStep.idle,
    this.sasEmojis = const [],
    this.errorMessage,
    this.machineName,
    this.os,
  });

  final PairingStep step;
  final List<String> sasEmojis;
  final String? errorMessage;
  final String? machineName;
  final String? os;

  bool get isBusy =>
      step == PairingStep.connecting || step == PairingStep.confirming;

  PairingState copyWith({
    PairingStep? step,
    List<String>? sasEmojis,
    Object? errorMessage = _pairingUnset,
    Object? machineName = _pairingUnset,
    Object? os = _pairingUnset,
  }) {
    return PairingState(
      step: step ?? this.step,
      sasEmojis: sasEmojis ?? this.sasEmojis,
      errorMessage:
          identical(errorMessage, _pairingUnset)
              ? this.errorMessage
              : errorMessage as String?,
      machineName:
          identical(machineName, _pairingUnset)
              ? this.machineName
              : machineName as String?,
      os: identical(os, _pairingUnset) ? this.os : os as String?,
    );
  }
}

class PairingController extends StateNotifier<PairingState> {
  PairingController(this._ref) : super(const PairingState());

  final Ref _ref;

  WsClient? _pairingClient;
  StreamSubscription<InnerMessage>? _pairingMessagesSub;
  Completer<Map<String, dynamic>>? _sasCompleter;
  Completer<String>? _authTokenCompleter;
  String _serverUrl = '';

  Future<bool> startFromQr(String qrPayload) async {
    try {
      final data = jsonDecode(qrPayload) as Map<String, dynamic>;
      final pairingCode = data['pairing_code'];
      final serverUrl = data['server_url'];
      if (pairingCode is! String || serverUrl is! String) {
        throw const FormatException(
          'QR payload missing pairing_code/server_url',
        );
      }

      return _start(pairingCode: pairingCode, serverUrl: serverUrl);
    } catch (_) {
      state = const PairingState(
        step: PairingStep.error,
        errorMessage: '二维码格式无效',
      );
      return false;
    }
  }

  Future<bool> startManual(String pairingCode, String serverUrl) =>
      _start(pairingCode: pairingCode, serverUrl: serverUrl);

  Future<bool> confirmSas(bool confirmed) async {
    final client = _pairingClient;
    if (client == null) {
      state = const PairingState(
        step: PairingStep.error,
        errorMessage: '当前没有待确认的配对请求',
      );
      return false;
    }

    state = state.copyWith(step: PairingStep.confirming, errorMessage: null);

    try {
      await client.send(
        InnerMessage.create('device.pair.confirm', {'confirmed': confirmed}),
      );

      if (!confirmed) {
        await Future<void>.delayed(const Duration(milliseconds: 150));
        await _clearPending(disposeClient: true);
        state = const PairingState(
          step: PairingStep.error,
          errorMessage: 'SAS 核对不一致，配对已取消',
        );
        return false;
      }

      final jwt = await (_authTokenCompleter?.future ??
              Future<String>.error(StateError('auth.token listener missing')))
          .timeout(const Duration(seconds: 15));

      await AppRuntimeStore.persist(serverUrl: _serverUrl, jwt: jwt);

      await _pairingMessagesSub?.cancel();
      _pairingMessagesSub = null;
      _sasCompleter = null;
      _authTokenCompleter = null;
      _pairingClient = null;

      final previous = _ref.read(wsClientProvider);
      _ref.read(wsClientProvider.notifier).state = client;
      if (previous != null && !identical(previous, client)) {
        previous.dispose();
      }

      state = state.copyWith(step: PairingStep.done, errorMessage: null);
      return true;
    } catch (error) {
      await _fail(_friendlyError(error));
      return false;
    }
  }

  Future<void> reset() async {
    await _clearPending(disposeClient: true);
    state = const PairingState();
  }

  Future<bool> _start({
    required String pairingCode,
    required String serverUrl,
  }) async {
    final trimmedCode = pairingCode.trim();
    final trimmedUrl = serverUrl.trim();
    final uri = Uri.tryParse(trimmedUrl);
    final validScheme =
        uri != null &&
        (uri.scheme == 'ws' || uri.scheme == 'wss') &&
        uri.host.isNotEmpty;

    if (trimmedCode.isEmpty || !validScheme) {
      state = const PairingState(
        step: PairingStep.error,
        errorMessage: '请输入有效的配对码和 ws/wss 服务器地址',
      );
      return false;
    }

    await _clearPending(disposeClient: true);
    _serverUrl = trimmedUrl;
    state = const PairingState(step: PairingStep.connecting);
    debugPrint('[Pairing] start code=$trimmedCode server=$trimmedUrl');

    try {
      final keys = await DeviceKeys.generate();
      final jwtHolder = _JwtHolder('');
      final client = WsClient(
        serverUri: uri,
        deviceId: await AppRuntimeStore.loadOrCreateInstanceId(),
        getJwt: () => jwtHolder.value,
        onJwt: (nextJwt) {
          jwtHolder.value = nextJwt;
          unawaited(_persistRuntimeJwt(trimmedUrl, nextJwt));
        },
      );

      _pairingClient = client;
      _sasCompleter = Completer<Map<String, dynamic>>();
      _authTokenCompleter = Completer<String>();
      _pairingMessagesSub = client.messages.listen(_handlePairingMessage);

      await client.connect();
      debugPrint('[Pairing] connected, sending device.pair');
      await client.send(
        InnerMessage.create('device.pair', {
          'pairing_code': trimmedCode,
          'server_url': trimmedUrl,
          'app_pubkey': await keys.x25519PubBase64(),
          'app_ed25519_pubkey': await keys.ed25519PubBase64(),
          'app_device_name': AppRuntimeStore.defaultDeviceName(),
        }),
      );

      final sasPayload = await (_sasCompleter?.future ??
              Future<Map<String, dynamic>>.error(
                StateError('SAS listener missing'),
              ))
          .timeout(const Duration(seconds: 15));
      debugPrint('[Pairing] sas received');
      final sasValues = _extractSasValues(sasPayload);
      if (sasValues.length != 5) {
        throw const FormatException('invalid SAS payload');
      }

      state = PairingState(
        step: PairingStep.waitingSas,
        sasEmojis: sasValues,
        machineName: sasPayload['machine_name'] as String?,
        os: sasPayload['os'] as String?,
      );
      return true;
    } catch (error) {
      debugPrint('[Pairing] failed -> ${_friendlyError(error)}');
      await _fail(_friendlyError(error));
      return false;
    }
  }

  void _handlePairingMessage(InnerMessage message) {
    debugPrint('[Pairing] message <- ${message.type}');
    if (message.type == 'device.pair.sas') {
      final completer = _sasCompleter;
      if (completer != null && !completer.isCompleted) {
        completer.complete(message.payload);
      }
      return;
    }

    if (message.type == 'auth.token') {
      final jwt = message.payload['jwt'];
      final completer = _authTokenCompleter;
      if (jwt is String && completer != null && !completer.isCompleted) {
        completer.complete(jwt);
      }
      return;
    }

    if (message.type == 'error') {
      final text = message.payload['message'] as String? ?? '配对失败';
      unawaited(_fail(text));
    }
  }

  Future<void> _persistRuntimeJwt(String serverUrl, String jwt) async {
    try {
      await AppRuntimeStore.persist(serverUrl: serverUrl, jwt: jwt);
    } catch (_) {
      // Pairing flow will surface a user-visible error if persistence fails.
    }
  }

  Future<void> _fail(String message) async {
    _completePendingWithError(message);
    await _clearPending(disposeClient: true);
    state = PairingState(step: PairingStep.error, errorMessage: message);
  }

  void _completePendingWithError(String message) {
    final error = StateError(message);
    if (_sasCompleter != null && !_sasCompleter!.isCompleted) {
      _sasCompleter!.completeError(error);
    }
    if (_authTokenCompleter != null && !_authTokenCompleter!.isCompleted) {
      _authTokenCompleter!.completeError(error);
    }
  }

  Future<void> _clearPending({required bool disposeClient}) async {
    await _pairingMessagesSub?.cancel();
    _pairingMessagesSub = null;
    final client = _pairingClient;
    _pairingClient = null;
    _sasCompleter = null;
    _authTokenCompleter = null;
    if (disposeClient) {
      client?.dispose();
    }
  }

  List<String> _extractSasValues(Map<String, dynamic> payload) {
    final raw = payload['sas'];
    if (raw is! List) {
      return const [];
    }
    return raw.whereType<String>().toList(growable: false);
  }

  String _friendlyError(Object error) {
    if (error is TimeoutException) {
      return '等待电脑端响应超时，请重新获取配对码后再试';
    }
    if (error is StateError) {
      return error.message.toString();
    }
    if (error is FormatException) {
      return '配对数据格式无效';
    }
    final text = error.toString();
    if (text.startsWith('StateError: ')) {
      return text.substring('StateError: '.length);
    }
    return text;
  }

  @override
  void dispose() {
    unawaited(_clearPending(disposeClient: true));
    super.dispose();
  }
}

class _JwtHolder {
  _JwtHolder(this.value);

  String value;
}

final pairingControllerProvider =
    StateNotifierProvider<PairingController, PairingState>(
      (ref) => PairingController(ref),
    );
