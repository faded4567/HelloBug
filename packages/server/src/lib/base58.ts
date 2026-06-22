const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = BigInt(ALPHABET.length);

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";

  while (value > 0n) {
    const remainder = Number(value % BASE);
    encoded = `${ALPHABET[remainder]}${encoded}`;
    value /= BASE;
  }

  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    encoded = `${ALPHABET[0]}${encoded}`;
  }

  return encoded || ALPHABET[0];
}

