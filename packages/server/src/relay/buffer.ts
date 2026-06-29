import type { Envelope, Message } from "@hellobug/protocol";

type SessionEventMessage = Extract<Message, { type: "session.event" }>;

export interface RelayReplayEntry {
  message: SessionEventMessage;
  envelope?: Envelope;
  storedAt: number;
  replaySeq: number;
}

export interface RelayReplayResult {
  entries: RelayReplayEntry[];
  replayedCount: number;
  currentSeq: number;
}

interface SessionReplayBuffer {
  currentSeq: number;
  updatedAt: number;
  entries: RelayReplayEntry[];
}

export interface RelayReplayBufferOptions {
  capacity?: number;
  ttlMs?: number;
  now?: () => number;
}

export class RelayReplayBuffer {
  private readonly sessions = new Map<string, SessionReplayBuffer>();
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: RelayReplayBufferOptions = {}) {
    this.capacity = options.capacity ?? 500;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  append(message: SessionEventMessage, envelope?: Envelope): void {
    const ts = this.now();
    this.pruneExpired(ts);

    const sessionId = message.payload.session_id;
    const buffer = this.sessions.get(sessionId) ?? {
      currentSeq: 0,
      updatedAt: ts,
      entries: [],
    };

    buffer.updatedAt = ts;
    const replaySeq = envelope?.seq ?? message.payload.seq;
    buffer.currentSeq = Math.max(buffer.currentSeq, replaySeq);
    buffer.entries.push({
      message,
      envelope,
      storedAt: ts,
      replaySeq,
    });

    if (buffer.entries.length > this.capacity) {
      buffer.entries.splice(0, buffer.entries.length - this.capacity);
    }

    this.sessions.set(sessionId, buffer);
  }

  replay(sessionId: string, lastSeq: number): RelayReplayResult {
    const ts = this.now();
    this.pruneExpired(ts);

    const buffer = this.sessions.get(sessionId);
    if (!buffer) {
      return {
        entries: [],
        replayedCount: 0,
        currentSeq: lastSeq,
      };
    }

    const entries = buffer.entries
      .filter((entry) => entry.replaySeq > lastSeq)
      .sort((left, right) => left.replaySeq - right.replaySeq)
      .map((entry) => ({
        ...entry,
      }));

    return {
      entries,
      replayedCount: entries.length,
      currentSeq: buffer.currentSeq,
    };
  }

  getSessionSize(sessionId: string): number {
    const ts = this.now();
    this.pruneExpired(ts);
    return this.sessions.get(sessionId)?.entries.length ?? 0;
  }

  private pruneExpired(ts: number): void {
    for (const [sessionId, buffer] of this.sessions.entries()) {
      if (ts - buffer.updatedAt > this.ttlMs) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
