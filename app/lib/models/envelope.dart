// ignore_for_file: invalid_annotation_target
import 'package:freezed_annotation/freezed_annotation.dart';

part 'envelope.freezed.dart';
part 'envelope.g.dart';

@freezed
abstract class Envelope with _$Envelope {
  @JsonSerializable(fieldRename: FieldRename.snake)
  const factory Envelope({
    required String from,
    required String to,
    @Default('') String sessionId,
    required int seq,
    required int ts,
    required String sig,
    required String ciphertext,
  }) = _Envelope;

  factory Envelope.fromJson(Map<String, dynamic> json) =>
      _$EnvelopeFromJson(json);
}
