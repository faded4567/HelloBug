import { z } from "zod";

export const ProtocolVersion = 1;

export const StringIdSchema = z.string().min(1);
export const TimestampMsSchema = z.number().int().nonnegative();
export const SequenceSchema = z.number().int().nonnegative();
export const OptionalNullableStringSchema = z.string().min(1).nullable().optional();

export const EnvelopeSchema = z.object({
  from: StringIdSchema,
  to: z.string(),
  session_id: z.string(),
  seq: SequenceSchema,
  ts: TimestampMsSchema,
  sig: z.string(),
  ciphertext: z.string().min(1),
});

export const InnerMessageSchema = z.object({
  v: z.literal(ProtocolVersion).default(ProtocolVersion),
  id: StringIdSchema,
  type: z.string().min(1),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type InnerMessage = z.infer<typeof InnerMessageSchema>;

export function validateEnvelope(raw: unknown): Envelope {
  return EnvelopeSchema.parse(raw);
}

export function validateInnerMessage(raw: unknown): InnerMessage {
  return InnerMessageSchema.parse(raw);
}
