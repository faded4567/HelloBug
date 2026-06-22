// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'envelope.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$Envelope {

 String get from; String get to; String get sessionId; int get seq; int get ts; String get sig; String get ciphertext;
/// Create a copy of Envelope
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$EnvelopeCopyWith<Envelope> get copyWith => _$EnvelopeCopyWithImpl<Envelope>(this as Envelope, _$identity);

  /// Serializes this Envelope to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is Envelope&&(identical(other.from, from) || other.from == from)&&(identical(other.to, to) || other.to == to)&&(identical(other.sessionId, sessionId) || other.sessionId == sessionId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.ts, ts) || other.ts == ts)&&(identical(other.sig, sig) || other.sig == sig)&&(identical(other.ciphertext, ciphertext) || other.ciphertext == ciphertext));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,from,to,sessionId,seq,ts,sig,ciphertext);

@override
String toString() {
  return 'Envelope(from: $from, to: $to, sessionId: $sessionId, seq: $seq, ts: $ts, sig: $sig, ciphertext: $ciphertext)';
}


}

/// @nodoc
abstract mixin class $EnvelopeCopyWith<$Res>  {
  factory $EnvelopeCopyWith(Envelope value, $Res Function(Envelope) _then) = _$EnvelopeCopyWithImpl;
@useResult
$Res call({
 String from, String to, String sessionId, int seq, int ts, String sig, String ciphertext
});




}
/// @nodoc
class _$EnvelopeCopyWithImpl<$Res>
    implements $EnvelopeCopyWith<$Res> {
  _$EnvelopeCopyWithImpl(this._self, this._then);

  final Envelope _self;
  final $Res Function(Envelope) _then;

/// Create a copy of Envelope
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? from = null,Object? to = null,Object? sessionId = null,Object? seq = null,Object? ts = null,Object? sig = null,Object? ciphertext = null,}) {
  return _then(_self.copyWith(
from: null == from ? _self.from : from // ignore: cast_nullable_to_non_nullable
as String,to: null == to ? _self.to : to // ignore: cast_nullable_to_non_nullable
as String,sessionId: null == sessionId ? _self.sessionId : sessionId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,ts: null == ts ? _self.ts : ts // ignore: cast_nullable_to_non_nullable
as int,sig: null == sig ? _self.sig : sig // ignore: cast_nullable_to_non_nullable
as String,ciphertext: null == ciphertext ? _self.ciphertext : ciphertext // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [Envelope].
extension EnvelopePatterns on Envelope {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _Envelope value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _Envelope() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _Envelope value)  $default,){
final _that = this;
switch (_that) {
case _Envelope():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _Envelope value)?  $default,){
final _that = this;
switch (_that) {
case _Envelope() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String from,  String to,  String sessionId,  int seq,  int ts,  String sig,  String ciphertext)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _Envelope() when $default != null:
return $default(_that.from,_that.to,_that.sessionId,_that.seq,_that.ts,_that.sig,_that.ciphertext);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String from,  String to,  String sessionId,  int seq,  int ts,  String sig,  String ciphertext)  $default,) {final _that = this;
switch (_that) {
case _Envelope():
return $default(_that.from,_that.to,_that.sessionId,_that.seq,_that.ts,_that.sig,_that.ciphertext);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String from,  String to,  String sessionId,  int seq,  int ts,  String sig,  String ciphertext)?  $default,) {final _that = this;
switch (_that) {
case _Envelope() when $default != null:
return $default(_that.from,_that.to,_that.sessionId,_that.seq,_that.ts,_that.sig,_that.ciphertext);case _:
  return null;

}
}

}

/// @nodoc

@JsonSerializable(fieldRename: FieldRename.snake)
class _Envelope implements Envelope {
  const _Envelope({required this.from, required this.to, this.sessionId = '', required this.seq, required this.ts, required this.sig, required this.ciphertext});
  factory _Envelope.fromJson(Map<String, dynamic> json) => _$EnvelopeFromJson(json);

@override final  String from;
@override final  String to;
@override@JsonKey() final  String sessionId;
@override final  int seq;
@override final  int ts;
@override final  String sig;
@override final  String ciphertext;

/// Create a copy of Envelope
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$EnvelopeCopyWith<_Envelope> get copyWith => __$EnvelopeCopyWithImpl<_Envelope>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$EnvelopeToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Envelope&&(identical(other.from, from) || other.from == from)&&(identical(other.to, to) || other.to == to)&&(identical(other.sessionId, sessionId) || other.sessionId == sessionId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.ts, ts) || other.ts == ts)&&(identical(other.sig, sig) || other.sig == sig)&&(identical(other.ciphertext, ciphertext) || other.ciphertext == ciphertext));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,from,to,sessionId,seq,ts,sig,ciphertext);

@override
String toString() {
  return 'Envelope(from: $from, to: $to, sessionId: $sessionId, seq: $seq, ts: $ts, sig: $sig, ciphertext: $ciphertext)';
}


}

/// @nodoc
abstract mixin class _$EnvelopeCopyWith<$Res> implements $EnvelopeCopyWith<$Res> {
  factory _$EnvelopeCopyWith(_Envelope value, $Res Function(_Envelope) _then) = __$EnvelopeCopyWithImpl;
@override @useResult
$Res call({
 String from, String to, String sessionId, int seq, int ts, String sig, String ciphertext
});




}
/// @nodoc
class __$EnvelopeCopyWithImpl<$Res>
    implements _$EnvelopeCopyWith<$Res> {
  __$EnvelopeCopyWithImpl(this._self, this._then);

  final _Envelope _self;
  final $Res Function(_Envelope) _then;

/// Create a copy of Envelope
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? from = null,Object? to = null,Object? sessionId = null,Object? seq = null,Object? ts = null,Object? sig = null,Object? ciphertext = null,}) {
  return _then(_Envelope(
from: null == from ? _self.from : from // ignore: cast_nullable_to_non_nullable
as String,to: null == to ? _self.to : to // ignore: cast_nullable_to_non_nullable
as String,sessionId: null == sessionId ? _self.sessionId : sessionId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,ts: null == ts ? _self.ts : ts // ignore: cast_nullable_to_non_nullable
as int,sig: null == sig ? _self.sig : sig // ignore: cast_nullable_to_non_nullable
as String,ciphertext: null == ciphertext ? _self.ciphertext : ciphertext // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

// dart format on
