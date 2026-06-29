import 'dart:convert';

import '../models/inner_message.dart';

const transportControlSessionId = 'transport.control.v1';

const encryptedTransportControlMessageTypes = <String>{
  'auth.attach',
  'auth.refresh',
  'device.push_token',
  'device.list',
  'device.rename',
  'device.revoke',
  'workspace.list',
  'workspace.resolve',
  'history.list',
  'templates.list',
};

const serverHandledEncryptedMessageTypes = <String>{
  'auth.attach',
  'auth.refresh',
  'device.push_token',
  'device.list',
  'device.rename',
  'device.revoke',
  'session.start',
  'danger.allow',
  'danger.deny',
  'device.pair',
  'device.pair.confirm',
  'session.resume',
};

String resolveEnvelopeSessionIdForMessage(InnerMessage message) {
  final payloadSessionId = message.payload['session_id'] as String?;
  if (payloadSessionId != null && payloadSessionId.isNotEmpty) {
    return payloadSessionId;
  }

  if (encryptedTransportControlMessageTypes.contains(message.type)) {
    return transportControlSessionId;
  }

  if (message.type == 'error') {
    final requestId = message.payload['request_id'] as String?;
    final sessionId = message.payload['session_id'];
    if (requestId != null &&
        requestId.isNotEmpty &&
        (sessionId == null || sessionId == transportControlSessionId)) {
      return transportControlSessionId;
    }
  }

  return '';
}

String? envelopeRequestIdForMessage(InnerMessage message) {
  if (message.id.isNotEmpty) {
    return message.id;
  }

  final payloadRequestId = message.payload['request_id'] as String?;
  if (payloadRequestId != null && payloadRequestId.isNotEmpty) {
    return payloadRequestId;
  }

  return null;
}

String? envelopeRoutingPayloadForMessage(InnerMessage message) {
  if (!serverHandledEncryptedMessageTypes.contains(message.type)) {
    return null;
  }

  return base64Url.encode(utf8.encode(jsonEncode(message.payload)));
}
