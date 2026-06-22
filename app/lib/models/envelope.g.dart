// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'envelope.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_Envelope _$EnvelopeFromJson(Map<String, dynamic> json) => _Envelope(
  from: json['from'] as String,
  to: json['to'] as String,
  sessionId: json['session_id'] as String? ?? '',
  seq: (json['seq'] as num).toInt(),
  ts: (json['ts'] as num).toInt(),
  sig: json['sig'] as String,
  ciphertext: json['ciphertext'] as String,
);

Map<String, dynamic> _$EnvelopeToJson(_Envelope instance) => <String, dynamic>{
  'from': instance.from,
  'to': instance.to,
  'session_id': instance.sessionId,
  'seq': instance.seq,
  'ts': instance.ts,
  'sig': instance.sig,
  'ciphertext': instance.ciphertext,
};
