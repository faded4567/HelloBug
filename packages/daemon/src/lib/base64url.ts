export function toBase64Url(input: Buffer | Uint8Array | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
  return buffer.toString("base64url");
}

