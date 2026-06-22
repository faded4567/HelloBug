import type { Message } from "@hellobug/protocol";

type SessionEventMessage = Extract<Message, { type: "session.event" }>;

export interface RelayReplayEntry {
  message: SessionEventMessage;
  storedAt: number;
}

export interface RelayReplayResult {
  messages: SessionEventMessage[];
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

  append(message: SessionEventMessage): void {
    const ts = this.now();
    this.pruneExpired(ts);

    const sessionId = message.payload.session_id;
    const buffer = this.sessions.get(sessionId) ?? {
      currentSeq: 0,
      updatedAt: ts,
      entries: [],
    };

    buffer.updatedAt = ts;
    buffer.currentSeq = Math.max(buffer.currentSeq, message.payload.seq);
    buffer.entries.push({
      message,
      storedAt: ts,
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
        messages: [],
        replayedCount: 0,
        currentSeq: lastSeq,
      };
    }

    const messages = buffer.entries
      .filter((entry) => entry.message.payload.seq > lastSeq)
      .map((entry) => entry.message)
      .sort((left, right) => left.payload.seq - right.payload.seq);

    return {
      messages,
      replayedCount: messages.length,
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
