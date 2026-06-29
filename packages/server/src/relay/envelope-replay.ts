import type { Envelope } from "@hellobug/protocol";

const DefaultEnvelopeReplayTtlMs = 5 * 60 * 1000;

export interface RelayEnvelopeReplayRegistryOptions {
  ttlMs?: number;
  now?: () => number;
}

export class RelayEnvelopeReplayRegistry {
  private readonly seenEnvelopes = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: RelayEnvelopeReplayRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DefaultEnvelopeReplayTtlMs;
    this.now = options.now ?? (() => Date.now());
  }

  remember(envelope: Envelope): boolean {
    const now = this.now();
    this.evictExpired(now);

    const key = this.createKey(envelope);
    const expiresAt = this.seenEnvelopes.get(key);
    if (expiresAt !== undefined && expiresAt > now) {
      return false;
    }

    // Keep the replay fingerprint alive for the same window in which the
    // timestamp could still pass skew validation.
    this.seenEnvelopes.set(key, envelope.ts + this.ttlMs + 1);
    return true;
  }

  private evictExpired(now: number): void {
    for (const [key, expiresAt] of this.seenEnvelopes.entries()) {
      if (expiresAt <= now) {
        this.seenEnvelopes.delete(key);
      }
    }
  }

  private createKey(envelope: Envelope): string {
    return JSON.stringify([envelope.from, envelope.sig]);
  }
}
