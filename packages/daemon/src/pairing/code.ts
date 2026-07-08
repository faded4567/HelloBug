import { createHmac, randomBytes, randomInt } from "node:crypto";

const SAS_EMOJI = [
  "🐢",
  "🪐",
  "🍵",
  "🎷",
  "🌙",
  "🧭",
  "🛠️",
  "📦",
  "🧪",
  "🌲",
  "🔥",
  "🌊",
];

export interface PairingSlot {
  pairing_id: string;
  pairing_code: string;
  expires_at: number;
}

export class PairingSlotManager {
  private readonly slots = new Map<string, PairingSlot>();

  issuePairingSlot(ttlMs = 300_000): PairingSlot {
    const slot: PairingSlot = {
      pairing_id: randomBytes(32).toString("hex"),
      pairing_code: randomInt(0, 1_000_000).toString().padStart(6, "0"),
      expires_at: Date.now() + ttlMs,
    };
    this.slots.set(slot.pairing_id, slot);
    return slot;
  }

  consumePairingSlot(pairingId: string): PairingSlot | null {
    const slot = this.slots.get(pairingId);
    if (!slot || slot.expires_at < Date.now()) {
      this.slots.delete(pairingId);
      return null;
    }
    this.slots.delete(pairingId);
    return slot;
  }

  findByCode(pairingCode: string): PairingSlot | null {
    for (const slot of this.slots.values()) {
      if (slot.pairing_code === pairingCode && slot.expires_at >= Date.now()) {
        return slot;
      }
    }
    return null;
  }

  pruneExpired(now = Date.now()): void {
    for (const [pairingId, slot] of this.slots.entries()) {
      if (slot.expires_at < now) {
        this.slots.delete(pairingId);
      }
    }
  }
}

export function getSas(sessionKey: Uint8Array | Buffer): string[] {
  const digest = createHmac("sha256", sessionKey).update("hellobug-sas").digest();
  return Array.from({ length: 5 }, (_, index) => SAS_EMOJI[digest[index] % SAS_EMOJI.length]!);
}

