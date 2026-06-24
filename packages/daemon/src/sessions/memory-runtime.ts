import type { SessionRuntime, SessionRuntimeEvents, SessionRuntimeStartOptions } from "./runtime.js";

export class MemorySessionRuntime implements SessionRuntime {
  private startedAt = 0;
  private active = false;

  constructor(private readonly events: SessionRuntimeEvents) {}

  async start(options: SessionRuntimeStartOptions): Promise<void> {
    this.startedAt = Date.now();
    this.active = true;
    void options;
  }

  async input(text: string): Promise<void> {
    await this.emitDelta(text.trim(), "echo");
  }

  async inputImage(filePath: string, mimeType: string): Promise<void> {
    await this.emitDelta(`${filePath} (${mimeType})`, "image");
  }

  async inputVoiceText(text: string, confidence: number): Promise<void> {
    void confidence;
    await this.emitDelta(text.trim(), "voice");
  }

  async inputSlashCommand(command: string, args: string[]): Promise<void> {
    const line = [command, ...args].join(" ").trim();
    await this.emitDelta(line, "slash");
  }

  async inputPty(data: string): Promise<void> {
    const decoded = Buffer.from(data, "base64").toString("utf8");
    await this.emitDelta(decoded, "pty");
  }

  async resizePty(cols: number, rows: number): Promise<void> {
    void cols;
    void rows;
  }

  async cancel(): Promise<void> {
    if (!this.active) {
      return;
    }

    this.active = false;
    await this.events.onSessionEvent?.({
      event_type: "session.done",
      exit_code: 130,
      duration_ms: Date.now() - this.startedAt,
    });
  }

  private async emitDelta(text: string, prefix: string): Promise<void> {
    if (!this.active) {
      throw new Error("session runtime is not active");
    }

    await this.events.onSessionEvent?.({
      event_type: "assistant.delta",
      text: text.length > 0 ? `${prefix}: ${text}` : `${prefix}:`,
    });
  }
}

export function createMemorySessionRuntime(events: SessionRuntimeEvents): MemorySessionRuntime {
  return new MemorySessionRuntime(events);
}
