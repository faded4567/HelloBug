import { z } from "zod";

export const ProtocolVersion = 1;
export const TransportControlSessionId = "transport.control.v1";

export const StringIdSchema = z.string().min(1);
export const TimestampMsSchema = z.number().int().nonnegative();
export const SequenceSchema = z.number().int().nonnegative();
export const OptionalNullableStringSchema = z
  .string()
  .min(1)
  .nullable()
  .optional();
export const CipherModeSchema = z.enum(["plain", "noise_static_v1"]);

export const EnvelopeSchema = z.object({
  from: StringIdSchema,
  to: z.string(),
  session_id: z.string(),
  seq: SequenceSchema,
  ts: TimestampMsSchema,
  sig: z.string(),
  ciphertext: z.string().min(1),
  message_type: z.string().min(1).optional(),
  cipher_mode: CipherModeSchema.optional(),
  sender_pubkey: z.string().min(1).optional(),
  request_id: z.string().min(1).optional(),
  routing_payload: z.string().min(1).optional(),
});

export const InnerMessageSchema = z.object({
  v: z.literal(ProtocolVersion).default(ProtocolVersion),
  id: StringIdSchema,
  type: z.string().min(1),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type InnerMessage = z.infer<typeof InnerMessageSchema>;
export type EnvelopeSigningFields = Pick<
  Envelope,
  | "from"
  | "to"
  | "session_id"
  | "seq"
  | "ts"
  | "ciphertext"
  | "message_type"
  | "cipher_mode"
  | "sender_pubkey"
  | "request_id"
  | "routing_payload"
>;
export type CipherMode = z.infer<typeof CipherModeSchema>;

export function validateEnvelope(raw: unknown): Envelope {
  return EnvelopeSchema.parse(raw);
}

export function validateInnerMessage(raw: unknown): InnerMessage {
  return InnerMessageSchema.parse(raw);
}

export function createEnvelopeSigningPayload(
  envelope: EnvelopeSigningFields,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      envelope.from,
      envelope.to,
      envelope.session_id,
      envelope.seq,
      envelope.ts,
      envelope.ciphertext,
      envelope.message_type ?? "",
      envelope.cipher_mode ?? "",
      envelope.sender_pubkey ?? "",
      envelope.request_id ?? "",
      envelope.routing_payload ?? "",
    ]),
  );
}
