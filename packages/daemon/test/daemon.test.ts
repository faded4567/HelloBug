import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { loadDaemonConfig } from "../src/config/load.js";
import { DeviceKeyStore } from "../src/crypto/keys.js";
import { SessionImageUploadStore } from "../src/fs/image.js";
import { DaemonSessionManager } from "../src/sessions/manager.js";
import { toBase64Url } from "../src/lib/base64url.js";
import { PairingSlotManager, getSas } from "../src/pairing/code.js";
import { DaemonConnection } from "../src/transport/connection.js";
import { createDaemonMessageRouter } from "../src/transport/message-router.js";

function createMessageReader(socket: import("ws").WebSocket) {
  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];

  socket.on("message", (raw) => {
    const parsed = JSON.parse(raw.toString()) as unknown;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(parsed);
      return;
    }

    queue.push(parsed);
  });

  return {
    async next(type?: string): Promise<any> {
      while (true) {
        const message =
          queue.shift() ??
          (await new Promise<unknown>((resolve, reject) => {
            const onClose = () => reject(new Error("socket closed"));
            const onError = (error: Error) => reject(error);

            socket.once("close", onClose);
            socket.once("error", onError);
            waiters.push((value) => {
              socket.off("close", onClose);
              socket.off("error", onError);
              resolve(value);
            });
          }));

        if (!type || (message as { type?: string }).type === type) {
          return message;
        }
      }
    },
  };
}

describe("daemon skeleton", () => {
  it("loads daemon config from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-config-"));
    const file = join(dir, "daemon.json");
    await writeFile(
      file,
      JSON.stringify({
        server_url: "ws://localhost:3000/v1/relay",
        allowed_paths: ["/tmp/work"],
      }),
    );

    const config = await loadDaemonConfig(file);
    expect(config.allowed_paths).toEqual(["/tmp/work"]);
  });

  it("creates and reuses device identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const store = new DeviceKeyStore(file);

    const first = await store.loadOrCreate();
    const second = await store.loadOrCreate();
    const raw = JSON.parse(await readFile(file, "utf8"));

    expect(first.deviceId).toBe(second.deviceId);
    expect(raw.ed25519PrivateKeyPem).toContain("BEGIN PRIVATE KEY");
  });

  it("issues and consumes pairing slots", () => {
    const slots = new PairingSlotManager();
    const slot = slots.issuePairingSlot(60_000);

    expect(slots.findByCode(slot.pairing_code)?.pairing_id).toBe(slot.pairing_id);
    expect(slots.consumePairingSlot(slot.pairing_id)?.pairing_code).toBe(slot.pairing_code);
    expect(slots.consumePairingSlot(slot.pairing_id)).toBeNull();
  });

  it("derives a five-symbol SAS", () => {
    const sas = getSas(Buffer.from("session-key"));
    expect(sas).toHaveLength(5);
  });

  it("responds to device.pair with a SAS payload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const serverUrl = `ws://127.0.0.1:${address.port}`;

    const connectionPromise = new Promise<{
      socket: import("ws").WebSocket;
      messages: ReturnType<typeof createMessageReader>;
    }>((resolve) => {
      server.once("connection", (socket) => {
        resolve({
          socket,
          messages: createMessageReader(socket),
        });
      });
    });

    const connection = new DaemonConnection({
      serverUrl,
      identity,
      certificates: {
        deviceId: "daemon-1",
        certPem: "cert",
        caCertPem: "ca",
      },
      handlers: {
        onMessage: createDaemonMessageRouter({
          identity,
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;

    const hello = await messages.next("daemon.hello");
    expect(hello.payload.device_id).toBe("daemon-1");

    socket.send(
      JSON.stringify({
        type: "device.pair",
        payload: {
          pairing_code: "428791",
          server_url: serverUrl,
          app_pubkey: "app-pub-key",
          app_ed25519_pubkey: "app-ed25519-pub-key",
          app_device_name: "Test iPhone",
        },
      }),
    );

    const sas = await messages.next("device.pair.sas");
    expect(sas.payload.sas).toHaveLength(5);
    expect(sas.payload.daemon_pubkey).toBe(identity.x25519PublicKeyBase64Url);
    expect(sas.payload.daemon_ed25519_pubkey).toBe(identity.ed25519PublicKeyBase64Url);
    expect(sas.payload.machine_name).toBeTypeOf("string");
    expect(sas.payload.os).toBeTypeOf("string");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("starts a session, echoes input, and emits session.done on cancel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const serverUrl = `ws://127.0.0.1:${address.port}`;

    const connectionPromise = new Promise<{
      socket: import("ws").WebSocket;
      messages: ReturnType<typeof createMessageReader>;
    }>((resolve) => {
      server.once("connection", (socket) => {
        resolve({
          socket,
          messages: createMessageReader(socket),
        });
      });
    });

    const sent: unknown[] = [];
    const connection = new DaemonConnection({
      serverUrl,
      identity,
      certificates: {
        deviceId: "daemon-1",
        certPem: "cert",
        caCertPem: "ca",
      },
      handlers: {
        onMessage: createDaemonMessageRouter({
          identity,
          sessions: new DaemonSessionManager({
            sendMessage: (message) => {
              sent.push(message);
              connection.sendMessage(message);
            },
            allowedPaths: ["/tmp/workspace"],
          }),
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;

    await messages.next("daemon.hello");

    socket.send(
      JSON.stringify({
        id: "start-1",
        type: "session.start",
        payload: {
          session_id: "session-daemon-1",
          agent_type: "shell",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      }),
    );

    socket.send(
      JSON.stringify({
        id: "input-1",
        type: "session.input",
        payload: {
          session_id: "session-daemon-1",
          text: "hello daemon",
        },
      }),
    );

    const sessionEvent = await messages.next("session.event");
    expect(sessionEvent.payload.session_id).toBe("session-daemon-1");
    expect(sessionEvent.payload.seq).toBe(1);
    expect(sessionEvent.payload.event.event_type).toBe("assistant.delta");
    expect(sessionEvent.payload.event.text).toBe("echo: hello daemon");

    socket.send(
      JSON.stringify({
        id: "cancel-1",
        type: "session.cancel",
        payload: {
          session_id: "session-daemon-1",
        },
      }),
    );

    const doneEvent = await messages.next("session.event");
    expect(doneEvent.payload.seq).toBe(2);
    expect(doneEvent.payload.event.event_type).toBe("session.done");
    expect(doneEvent.payload.event.exit_code).toBe(130);
    expect(sent).toHaveLength(2);

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("routes voice text and slash commands into the session runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const serverUrl = `ws://127.0.0.1:${address.port}`;

    const connectionPromise = new Promise<{
      socket: import("ws").WebSocket;
      messages: ReturnType<typeof createMessageReader>;
    }>((resolve) => {
      server.once("connection", (socket) => {
        resolve({
          socket,
          messages: createMessageReader(socket),
        });
      });
    });

    const connection = new DaemonConnection({
      serverUrl,
      identity,
      certificates: {
        deviceId: "daemon-1",
        certPem: "cert",
        caCertPem: "ca",
      },
      handlers: {
        onMessage: createDaemonMessageRouter({
          identity,
          sessions: new DaemonSessionManager({
            sendMessage: (message) => {
              connection.sendMessage(message);
            },
            allowedPaths: ["/tmp/workspace"],
          }),
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;

    await messages.next("daemon.hello");

    socket.send(
      JSON.stringify({
        id: "start-voice-1",
        type: "session.start",
        payload: {
          session_id: "session-voice-1",
          agent_type: "shell",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      }),
    );

    socket.send(
      JSON.stringify({
        id: "voice-1",
        type: "session.input.voice_text",
        payload: {
          session_id: "session-voice-1",
          text: "show changed files",
          confidence: 0.97,
        },
      }),
    );

    const voiceEvent = await messages.next("session.event");
    expect(voiceEvent.payload.seq).toBe(1);
    expect(voiceEvent.payload.event.event_type).toBe("assistant.delta");
    expect(voiceEvent.payload.event.text).toBe("voice: show changed files");

    socket.send(
      JSON.stringify({
        id: "slash-1",
        type: "session.command.slash",
        payload: {
          session_id: "session-voice-1",
          command: "/compact",
          args: [],
        },
      }),
    );

    const slashEvent = await messages.next("session.event");
    expect(slashEvent.payload.seq).toBe(2);
    expect(slashEvent.payload.event.event_type).toBe("assistant.delta");
    expect(slashEvent.payload.event.text).toBe("slash: /compact");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("assembles image chunks and passes the temp file path into the session runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const imageRoot = await mkdtemp(join(tmpdir(), "hellobug-images-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const serverUrl = `ws://127.0.0.1:${address.port}`;

    const connectionPromise = new Promise<{
      socket: import("ws").WebSocket;
      messages: ReturnType<typeof createMessageReader>;
    }>((resolve) => {
      server.once("connection", (socket) => {
        resolve({
          socket,
          messages: createMessageReader(socket),
        });
      });
    });

    const connection = new DaemonConnection({
      serverUrl,
      identity,
      certificates: {
        deviceId: "daemon-1",
        certPem: "cert",
        caCertPem: "ca",
      },
      handlers: {
        onMessage: createDaemonMessageRouter({
          identity,
          sessions: new DaemonSessionManager({
            sendMessage: (message) => {
              connection.sendMessage(message);
            },
            allowedPaths: ["/tmp/workspace"],
            imageUploadStore: new SessionImageUploadStore(imageRoot),
          }),
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;

    await messages.next("daemon.hello");

    socket.send(
      JSON.stringify({
        id: "start-image-1",
        type: "session.start",
        payload: {
          session_id: "session-image-1",
          agent_type: "shell",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      }),
    );

    socket.send(
      JSON.stringify({
        id: "image-1-0",
        type: "session.input.image",
        payload: {
          session_id: "session-image-1",
          image_id: "img-1",
          chunk_index: 0,
          total_chunks: 2,
          mime_type: "image/jpeg",
          data: toBase64Url(Buffer.from("hello ")),
        },
      }),
    );

    socket.send(
      JSON.stringify({
        id: "image-1-1",
        type: "session.input.image",
        payload: {
          session_id: "session-image-1",
          image_id: "img-1",
          chunk_index: 1,
          total_chunks: 2,
          mime_type: "image/jpeg",
          data: toBase64Url(Buffer.from("world")),
        },
      }),
    );

    const imageEvent = await messages.next("session.event");
    expect(imageEvent.payload.seq).toBe(1);
    expect(imageEvent.payload.event.event_type).toBe("assistant.delta");
    expect(imageEvent.payload.event.text).toContain("image:");
    expect(imageEvent.payload.event.text).toContain("img-1.jpg");
    expect(imageEvent.payload.event.text).toContain("(image/jpeg)");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("returns protocol error when session input targets a missing session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const serverUrl = `ws://127.0.0.1:${address.port}`;

    const connectionPromise = new Promise<{
      socket: import("ws").WebSocket;
      messages: ReturnType<typeof createMessageReader>;
    }>((resolve) => {
      server.once("connection", (socket) => {
        resolve({
          socket,
          messages: createMessageReader(socket),
        });
      });
    });

    const connection = new DaemonConnection({
      serverUrl,
      identity,
      certificates: {
        deviceId: "daemon-1",
        certPem: "cert",
        caCertPem: "ca",
      },
      handlers: {
        onMessage: createDaemonMessageRouter({
          identity,
          sessions: new DaemonSessionManager({
            sendMessage: (message) => {
              connection.sendMessage(message);
            },
            allowedPaths: ["/tmp/workspace"],
          }),
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;

    await messages.next("daemon.hello");

    socket.send(
      JSON.stringify({
        id: "input-missing-1",
        type: "session.input",
        payload: {
          session_id: "missing-session",
          text: "hello daemon",
        },
      }),
    );

    const errorMessage = await messages.next("error");
    expect(errorMessage.payload.request_id).toBe("input-missing-1");
    expect(errorMessage.payload.code).toBe("SESSION_NOT_FOUND");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("rejects session.start outside allowed_paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const serverUrl = `ws://127.0.0.1:${address.port}`;

    const connectionPromise = new Promise<{
      socket: import("ws").WebSocket;
      messages: ReturnType<typeof createMessageReader>;
    }>((resolve) => {
      server.once("connection", (socket) => {
        resolve({
          socket,
          messages: createMessageReader(socket),
        });
      });
    });

    const connection = new DaemonConnection({
      serverUrl,
      identity,
      certificates: {
        deviceId: "daemon-1",
        certPem: "cert",
        caCertPem: "ca",
      },
      handlers: {
        onMessage: createDaemonMessageRouter({
          identity,
          sessions: new DaemonSessionManager({
            sendMessage: (message) => {
              connection.sendMessage(message);
            },
            allowedPaths: ["/safe/workspace"],
          }),
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;

    await messages.next("daemon.hello");

    socket.send(
      JSON.stringify({
        id: "start-forbidden-1",
        type: "session.start",
        payload: {
          session_id: "session-forbidden-1",
          agent_type: "shell",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      }),
    );

    const errorMessage = await messages.next("error");
    expect(errorMessage.payload.request_id).toBe("start-forbidden-1");
    expect(errorMessage.payload.code).toBe("WORKSPACE_FORBIDDEN");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });
});
