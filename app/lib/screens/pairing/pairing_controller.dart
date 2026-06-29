import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../crypto/envelope_signer.dart';
import '../../crypto/keys.dart';
import '../../crypto/noise_ik.dart';
import '../../crypto/pairing_sas.dart';
import '../../models/device_summary.dart';
import '../../models/inner_message.dart';
import '../../state/devices_provider.dart';
import '../../transport/app_runtime_store.dart';
import '../../transport/pinned_http_client.dart';
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
  final NoiseIk _noise = NoiseIk();

  WsClient? _pairingClient;
  StreamSubscription<InnerMessage>? _pairingMessagesSub;
  Completer<Map<String, dynamic>>? _sasCompleter;
  Completer<String>? _authTokenCompleter;
  Completer<Map<String, dynamic>>? _deviceStatusCompleter;
  String _serverUrl = '';
  String? _pendingDaemonPubKey;
  String? _pendingDaemonEd25519PubKey;
  String? _pendingServerPin;
  String? _pendingNoiseHandshake;
  String? _pendingInitialTransportSendKey;
  String? _pendingInitialTransportRecvKey;

  Future<bool> startFromQr(String qrPayload) async {
    try {
      final data = jsonDecode(qrPayload) as Map<String, dynamic>;
      final pairingCode = data['pairing_code'];
      final serverUrl = data['server_url'];
      final serverPin = data['server_pin'];
      if (pairingCode is! String || serverUrl is! String) {
        throw const FormatException(
          'QR payload missing pairing_code/server_url',
        );
      }

      return _start(
        pairingCode: pairingCode,
        serverUrl: serverUrl,
        serverPin: serverPin is String ? serverPin : null,
      );
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
    debugPrint('[Pairing] confirm sas confirmed=$confirmed');

    try {
      final payload = <String, dynamic>{'confirmed': confirmed};
      if (confirmed) {
        final noiseHandshake = _pendingNoiseHandshake;
        if (noiseHandshake == null || noiseHandshake.isEmpty) {
          throw StateError('配对握手未完成，请重新获取配对码后再试');
        }
        payload['noise_handshake'] = noiseHandshake;
      }

      await client.send(InnerMessage.create('device.pair.confirm', payload));

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
      Map<String, dynamic>? deviceStatus;
      final deviceStatusFuture = _deviceStatusCompleter?.future;
      if (deviceStatusFuture != null) {
        try {
          deviceStatus = await deviceStatusFuture.timeout(
            const Duration(seconds: 5),
          );
        } catch (_) {
          deviceStatus = null;
        }
      }
      debugPrint('[Pairing] auth token received, persisting runtime');
      final pairedDaemonId = deviceStatus?['device_id'] as String?;
      final appDeviceId = AppRuntimeStore.parseDeviceIdFromJwt(jwt);
      if (appDeviceId != null) {
        client.updateDeviceId(appDeviceId);
      }

      await AppRuntimeStore.persist(
        serverUrl: _serverUrl,
        jwt: jwt,
        serverPin: _resolvedServerPin(),
        pairedDaemonId: pairedDaemonId,
        pairedDaemonPubKey: _pendingDaemonPubKey,
        pairedDaemonEd25519PubKey: _pendingDaemonEd25519PubKey,
        initialTransportSendKey: _pendingInitialTransportSendKey,
        initialTransportRecvKey: _pendingInitialTransportRecvKey,
        machineName: state.machineName,
        os: state.os,
      );
      if (_pendingDaemonPubKey != null && _pendingDaemonPubKey!.isNotEmpty) {
        AppRuntimeStore.configureClientCrypto(
          client,
          pairedDaemonPubKey: _pendingDaemonPubKey!,
          initialTransportSendKey: _pendingInitialTransportSendKey,
          initialTransportRecvKey: _pendingInitialTransportRecvKey,
        );
      }
      if (pairedDaemonId != null) {
        _ref
            .read(devicesProvider.notifier)
            .upsert(
              DeviceSummary(
                deviceId: pairedDaemonId,
                machineName:
                    (deviceStatus?['machine_name'] as String?) ??
                    state.machineName ??
                    'Unknown device',
                os: state.os ?? '',
                online: true,
                lastSeen: DateTime.now(),
              ),
            );
      }

      await _pairingMessagesSub?.cancel();
      _pairingMessagesSub = null;
      _sasCompleter = null;
      _authTokenCompleter = null;
      _deviceStatusCompleter = null;
      _pairingClient = null;
      _pendingDaemonPubKey = null;
      _pendingDaemonEd25519PubKey = null;
      _pendingServerPin = null;
      _pendingNoiseHandshake = null;
      _pendingInitialTransportSendKey = null;
      _pendingInitialTransportRecvKey = null;

      final previous = _ref.read(wsClientProvider);
      _ref.read(wsClientProvider.notifier).state = client;
      if (previous != null && !identical(previous, client)) {
        previous.dispose();
      }
      debugPrint(
        '[Pairing] live ws client installed paired_daemon=$pairedDaemonId',
      );

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
    String? serverPin,
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
    _pendingServerPin = serverPin?.trim();
    state = const PairingState(step: PairingStep.connecting);
    debugPrint('[Pairing] start code=$trimmedCode server=$trimmedUrl');

    try {
      final resolvedUri = uri;
      PinnedHttpClient.configure(resolvedUri, pin: _pendingServerPin);
      final keys = await DeviceKeys.loadOrCreate();
      final signer = EnvelopeSigner(keys.ed25519);
      final jwtHolder = _JwtHolder('');
      final client = WsClient(
        serverUri: resolvedUri,
        deviceId: await AppRuntimeStore.loadOrCreateInstanceId(),
        getJwt: () => jwtHolder.value,
        onJwt: (nextJwt) {
          jwtHolder.value = nextJwt;
          unawaited(_persistRuntimeJwt(trimmedUrl, nextJwt));
        },
        signEnvelope: signer.sign,
      );

      _pairingClient = client;
      _sasCompleter = Completer<Map<String, dynamic>>();
      _authTokenCompleter = Completer<String>();
      _deviceStatusCompleter = Completer<Map<String, dynamic>>();
      _pairingMessagesSub = client.messages.listen(_handlePairingMessage);

      await client.connect(rethrowErrors: true);
      _pendingServerPin = _resolvedServerPin();
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
      _pendingDaemonPubKey = _extractString(sasPayload, 'daemon_pubkey');
      _pendingDaemonEd25519PubKey = _extractString(
        sasPayload,
        'daemon_ed25519_pubkey',
      );
      final noiseHandshake = _extractString(sasPayload, 'noise_handshake');
      if (_pendingDaemonPubKey == null || _pendingDaemonEd25519PubKey == null) {
        throw const FormatException('pairing payload missing daemon keys');
      }
      if (noiseHandshake == null) {
        throw StateError('电脑端版本过旧，缺少配对握手数据');
      }

      final responded = await _noise.respondHandshake(
        localStaticPriv: Uint8List.fromList(
          await keys.x25519.extractPrivateKeyBytes(),
        ),
        localStaticPub: Uint8List.fromList(
          (await keys.x25519.extractPublicKey()).bytes,
        ),
        remoteStaticPub: NoiseIk.decodePublicKeyBase64Url(
          _pendingDaemonPubKey!,
        ),
        message: _decodeBase64Url(noiseHandshake),
      );
      final expectedSas = await derivePairingSas(
        responded.pairingHandshakeHash,
      );
      if (!listEquals(expectedSas, sasValues)) {
        throw StateError('SAS 校验失败，请重新开始配对');
      }
      _pendingNoiseHandshake = _encodeBase64Url(responded.message);
      _pendingInitialTransportSendKey = _encodeBase64Url(responded.sendKey);
      _pendingInitialTransportRecvKey = _encodeBase64Url(responded.recvKey);

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

    if (message.type == 'device.status') {
      final completer = _deviceStatusCompleter;
      if (completer != null && !completer.isCompleted) {
        completer.complete(message.payload);
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
      debugPrint('[Pairing] persist jwt server=$serverUrl');
      await AppRuntimeStore.persist(
        serverUrl: serverUrl,
        jwt: jwt,
        serverPin: _resolvedServerPin(serverUrl),
      );
    } catch (_) {
      // Pairing flow will surface a user-visible error if persistence fails.
    }
  }

  Future<void> _fail(String message) async {
    debugPrint('[Pairing] error -> $message');
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
    _deviceStatusCompleter = null;
    _pendingDaemonPubKey = null;
    _pendingDaemonEd25519PubKey = null;
    _pendingServerPin = null;
    _pendingNoiseHandshake = null;
    _pendingInitialTransportSendKey = null;
    _pendingInitialTransportRecvKey = null;
    if (disposeClient) {
      client?.dispose();
    }
  }

  String? _extractString(Map<String, dynamic> payload, String key) {
    final value = payload[key];
    return value is String && value.isNotEmpty ? value : null;
  }

  List<String> _extractSasValues(Map<String, dynamic> payload) {
    final raw = payload['sas'];
    if (raw is! List) {
      return const [];
    }
    return raw.whereType<String>().toList(growable: false);
  }

  Uint8List _decodeBase64Url(String encoded) =>
      Uint8List.fromList(base64Url.decode(base64Url.normalize(encoded)));

  String _encodeBase64Url(List<int> bytes) =>
      base64Url.encode(bytes).replaceAll('=', '');

  String? _resolvedServerPin([String? serverUrl]) {
    final targetUrl = serverUrl ?? _serverUrl;
    final uri = Uri.tryParse(targetUrl);
    if (uri == null) {
      return _pendingServerPin;
    }
    return PinnedHttpClient.resolvedPin(uri) ?? _pendingServerPin;
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
