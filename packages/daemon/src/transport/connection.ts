import { type Message, validateMessage } from "@hellobug/protocol";
import { WebSocket } from "ws";

import type { DeviceIdentity } from "../crypto/keys.js";
import type { PairingSlot } from "../pairing/code.js";
import type { DaemonCertificateBundle } from "./register.js";

export interface DaemonConnectionHandlers {
  onMessage?: (message: Message, connection: DaemonConnection) => void | Promise<void>;
}

export interface DaemonConnectionOptions {
  serverUrl: string;
  identity: DeviceIdentity;
  certificates: DaemonCertificateBundle;
  supportedFeatures?: string[];
  handlers?: DaemonConnectionHandlers;
}

export class DaemonConnection {
  private socket: WebSocket | null = null;

  constructor(private readonly options: DaemonConnectionOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.serverUrl);
      this.socket = socket;

      socket.once("open", () => {
        console.log(`[daemon] relay connected -> ${this.options.serverUrl}`);
        this.sendMessage({
          v: 1,
          type: "daemon.hello",
          payload: {
            device_id: this.options.certificates.deviceId,
            daemon_version: "0.1.0",
            supported_features: this.options.supportedFeatures ?? [
              "e2ee_noise_ik",
              "multi_session",
              "pty",
            ],
          },
        });
        resolve();
      });

      socket.on("message", async (raw) => {
        try {
          const parsed = validateMessage(JSON.parse(raw.toString()));
          console.log(`[daemon] recv <- ${parsed.type}`);
          if (parsed.type === "error") {
            console.log(
              `[daemon] error payload <- ${JSON.stringify(parsed.payload)}`,
            );
          }
          await this.handleIncomingMessage(parsed);
        } catch (error) {
          console.error("[daemon] incoming message error", error);
        }
      });

      socket.on("close", (code, reason) => {
        console.log(
          `[daemon] relay closed code=${code} reason=${reason.toString()}`,
        );
      });

      socket.once("error", (error: Error) => {
        console.error("[daemon] relay error", error);
        reject(error);
      });
    });
  }

  announcePairingSlot(slot: PairingSlot): void {
    this.sendMessage({
      v: 1,
      type: "device.pair.ready",
      payload: slot,
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }

  sendMessage(message: Omit<Message, "id"> & { id?: string }): void {
    console.log(`[daemon] send -> ${message.type}`);
    this.socket?.send(JSON.stringify(message));
  }

  private async handleIncomingMessage(message: Message): Promise<void> {
    await this.options.handlers?.onMessage?.(message, this);
  }
}
