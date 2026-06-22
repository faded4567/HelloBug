import { z } from "zod";

export const RegisterDaemonBodySchema = z.object({
  device_pub_key: z.string().min(1),
  bootstrap_token: z.string().min(1),
});

export const RegisterDaemonResponseSchema = z.object({
  device_id: z.string().min(1),
  cert: z.string().min(1),
  ca_cert: z.string().min(1),
});

export type RegisterDaemonBody = z.infer<typeof RegisterDaemonBodySchema>;
export type RegisterDaemonResponse = z.infer<typeof RegisterDaemonResponseSchema>;

