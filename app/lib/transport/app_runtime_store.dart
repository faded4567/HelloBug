import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../crypto/secure_store.dart';
import 'ws_client.dart';

class AppRuntimeState {
  const AppRuntimeState({
    required this.serverUrl,
    required this.deviceId,
    required this.jwt,
    this.pairedDaemonId,
    this.machineName,
    this.os,
  });

  final String serverUrl;
  // App-side device id embedded in the app JWT, used for auth.attach.
  final String deviceId;
  final String jwt;
  final String? pairedDaemonId;
  final String? machineName;
  final String? os;

  WsClient createClient() {
    var currentJwt = jwt;
    return WsClient(
      serverUri: Uri.parse(serverUrl),
      deviceId: deviceId,
      getJwt: () => currentJwt,
      onJwt: (nextJwt) {
        currentJwt = nextJwt;
        unawaited(SecureStore.write(SecureStore.keyJwt, nextJwt));
      },
    );
  }
}

class AppRuntimeStore {
  static final Random _rng = Random.secure();

  static Future<AppRuntimeState?> load() async {
    final serverUrl = await SecureStore.read(SecureStore.keyServerUrl);
    final deviceId = await SecureStore.read(SecureStore.keyPairedDeviceId);
    final jwt = await SecureStore.read(SecureStore.keyJwt);
    if (serverUrl == null || deviceId == null || jwt == null) {
      return null;
    }

    final machineName = await SecureStore.read(
      SecureStore.keyPairedMachineName,
    );
    final os = await SecureStore.read(SecureStore.keyPairedOs);
    final pairedDaemonId = await SecureStore.read(
      SecureStore.keyPairedDaemonId,
    );
    return AppRuntimeState(
      serverUrl: serverUrl,
      deviceId: deviceId,
      jwt: jwt,
      pairedDaemonId: pairedDaemonId,
      machineName: machineName,
      os: os,
    );
  }

  static Future<AppRuntimeState> persist({
    required String serverUrl,
    required String jwt,
    String? pairedDaemonId,
    String? machineName,
    String? os,
  }) async {
    final appDeviceId = parseDeviceIdFromJwt(jwt);
    if (appDeviceId == null) {
      throw const FormatException('JWT missing device_id');
    }

    await Future.wait([
      SecureStore.write(SecureStore.keyServerUrl, serverUrl),
      SecureStore.write(SecureStore.keyPairedDeviceId, appDeviceId),
      SecureStore.write(SecureStore.keyJwt, jwt),
      if (pairedDaemonId != null)
        SecureStore.write(SecureStore.keyPairedDaemonId, pairedDaemonId),
      if (machineName != null)
        SecureStore.write(SecureStore.keyPairedMachineName, machineName),
      if (os != null) SecureStore.write(SecureStore.keyPairedOs, os),
    ]);

    return AppRuntimeState(
      serverUrl: serverUrl,
      deviceId: appDeviceId,
      jwt: jwt,
      pairedDaemonId: pairedDaemonId,
      machineName: machineName,
      os: os,
    );
  }

  static Future<void> persistPairedDaemon({
    required String daemonDeviceId,
    String? machineName,
    String? os,
  }) async {
    await Future.wait([
      SecureStore.write(SecureStore.keyPairedDaemonId, daemonDeviceId),
      if (machineName != null)
        SecureStore.write(SecureStore.keyPairedMachineName, machineName),
      if (os != null) SecureStore.write(SecureStore.keyPairedOs, os),
    ]);
  }

  static Future<void> clear() async {
    await Future.wait([
      SecureStore.delete(SecureStore.keyServerUrl),
      SecureStore.delete(SecureStore.keyPairedDeviceId),
      SecureStore.delete(SecureStore.keyPairedDaemonId),
      SecureStore.delete(SecureStore.keyJwt),
      SecureStore.delete(SecureStore.keyPairedMachineName),
      SecureStore.delete(SecureStore.keyPairedOs),
    ]);
  }

  static Future<String> loadOrCreateInstanceId() async {
    final existing = await SecureStore.read(SecureStore.keyAppInstanceId);
    if (existing != null && existing.isNotEmpty) {
      return existing;
    }

    final created = _randomId();
    await SecureStore.write(SecureStore.keyAppInstanceId, created);
    return created;
  }

  static String defaultDeviceName() {
    if (kIsWeb) {
      return 'HelloBug Web';
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return 'HelloBug iPhone';
    }
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'HelloBug Android';
    }
    return 'HelloBug App';
  }

  static String? parseDeviceIdFromJwt(String jwt) {
    final parts = jwt.split('.');
    if (parts.length < 2) {
      return null;
    }

    try {
      final payload =
          jsonDecode(
                utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
              )
              as Map<String, dynamic>;
      final deviceId = payload['device_id'];
      return deviceId is String && deviceId.isNotEmpty ? deviceId : null;
    } catch (_) {
      return null;
    }
  }

  static String _randomId() {
    final bytes = List<int>.generate(16, (_) => _rng.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    String toHex(List<int> values) =>
        values.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${toHex(bytes.sublist(0, 4))}-${toHex(bytes.sublist(4, 6))}'
        '-${toHex(bytes.sublist(6, 8))}-${toHex(bytes.sublist(8, 10))}'
        '-${toHex(bytes.sublist(10))}';
  }
}
