import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hellobug/models/inner_message.dart';
import 'package:hellobug/transport/ws_channel_factory.dart';
import 'package:hellobug/transport/ws_client.dart';

void main() {
  group('WsClient transport crypto guard', () {
    test('allows pairing bootstrap placeholder messages without session crypto', () async {
      final socket = _FakePlatformWsSocket();
      final client = WsClient(
        serverUri: Uri.parse('ws://localhost:3000/v1/relay'),
        deviceId: 'app-device',
        getJwt: () => '',
        socketFactory: (_) => socket,
      );

      await client.connect();
      await client.send(
        InnerMessage.create('device.pair', {
          'pairing_code': '428791',
          'server_url': 'ws://localhost:3000/v1/relay',
        }),
      );

      expect(socket.sentTexts, hasLength(1));
      final envelope =
          jsonDecode(socket.sentTexts.single) as Map<String, dynamic>;
      expect(envelope['message_type'], 'device.pair');
      expect(envelope['cipher_mode'], 'noise_static_v1');
      expect(envelope['routing_payload'], isNotNull);

      client.dispose();
    });

    test('fails fast when runtime messages have no configured transport crypto', () async {
      final socket = _FakePlatformWsSocket();
      final client = WsClient(
        serverUri: Uri.parse('ws://localhost:3000/v1/relay'),
        deviceId: 'app-device',
        getJwt: () => '',
        socketFactory: (_) => socket,
      );

      await client.connect();

      await expectLater(
        client.send(InnerMessage.create('workspace.list', const {})),
        throwsA(
          isA<StateError>().having(
            (error) => error.toString(),
            'message',
            contains('workspace.list'),
          ),
        ),
      );
      expect(socket.sentTexts, isEmpty);

      client.dispose();
    });

    test(
      'decrypts daemon session.start.result envelopes even when routing_payload is present',
      () async {
        final socket = _FakePlatformWsSocket();
        final client = WsClient(
          serverUri: Uri.parse('ws://localhost:3000/v1/relay'),
          deviceId: 'app-device',
          getJwt: () => '',
          socketFactory: (_) => socket,
        );
        client.decrypt = ({
          required String ciphertext,
          required String sessionId,
          required int seq,
          required String messageType,
          required String cipherMode,
          String? senderPubkey,
        }) async {
          return utf8.decode(
            base64Url.decode(base64Url.normalize(ciphertext)),
          );
        };

        await client.connect();

        socket.addIncoming(
          jsonEncode({
            'from': 'daemon-device',
            'to': '',
            'session_id': 'session-start-1',
            'seq': 7,
            'ts': DateTime.now().millisecondsSinceEpoch,
            'sig': 'signature',
            'ciphertext': base64Url.encode(
              utf8.encode(
                jsonEncode({
                  'v': 1,
                  'id': 'session-start-result-1',
                  'type': 'session.start.result',
                  'payload': {
                    'request_id': 'session-start-1',
                    'session_id': 'session-start-1',
                    'agent_type': 'shell',
                    'workspace_path': '/tmp/workspace',
                    'status': 'started',
                    'message': 'Session started',
                  },
                }),
              ),
            ),
            'message_type': 'session.start.result',
            'cipher_mode': 'noise_static_v1',
            'sender_pubkey': 'daemon-x25519-pubkey',
            'request_id': 'session-start-1',
            'routing_payload': base64Url.encode(
              utf8.encode(jsonEncode({'status': 'started'})),
            ),
          }),
        );

        final result = await client.messages.firstWhere(
          (message) => message.type == 'session.start.result',
        );
        expect(result.payload['agent_type'], 'shell');
        expect(result.payload['workspace_path'], '/tmp/workspace');
        expect(result.payload['message'], 'Session started');

        client.dispose();
      },
    );
  });
}

class _FakePlatformWsSocket implements PlatformWsSocket {
  final _controller = StreamController<dynamic>.broadcast();
  final List<String> sentTexts = <String>[];
  bool _closed = false;

  @override
  Future<void> get ready => Future<void>.value();

  @override
  Stream<dynamic> get stream => _controller.stream;

  @override
  void sendText(String text) {
    sentTexts.add(text);
  }

  void addIncoming(dynamic frame) {
    _controller.add(frame);
  }

  @override
  Future<void> close() async {
    if (_closed) {
      return;
    }
    _closed = true;
    await _controller.close();
  }
}
