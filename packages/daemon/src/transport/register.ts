import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { z } from "zod";

const RegisterResponseSchema = z.object({
  device_id: z.string().min(1),
  cert: z.string().min(1),
  ca_cert: z.string().min(1),
});

export interface DaemonCertificateBundle {
  deviceId: string;
  certPem: string;
  caCertPem: string;
}

export class CertificateStore {
  constructor(
    private readonly filePath = resolve(homedir(), ".hellobug/device-cert.json"),
  ) {}

  async load(): Promise<DaemonCertificateBundle | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return RegisterResponseSchema.transform((value) => ({
        deviceId: value.device_id,
        certPem: value.cert,
        caCertPem: value.ca_cert,
      })).parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(bundle: DaemonCertificateBundle): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(
        {
          device_id: bundle.deviceId,
          cert: bundle.certPem,
          ca_cert: bundle.caCertPem,
        },
        null,
        2,
      ),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    await chmod(this.filePath, 0o600);
  }
}

export async function registerDaemon(input: {
  registerUrl: string;
  bootstrapToken: string;
  devicePubKey: string;
}): Promise<DaemonCertificateBundle> {
  const response = await fetch(new URL("/v1/register", input.registerUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      device_pub_key: input.devicePubKey,
      bootstrap_token: input.bootstrapToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Register daemon failed: ${response.status} ${body}`);
  }

  const parsed = RegisterResponseSchema.parse(await response.json());
  return {
    deviceId: parsed.device_id,
    certPem: parsed.cert,
    caCertPem: parsed.ca_cert,
  };
}

