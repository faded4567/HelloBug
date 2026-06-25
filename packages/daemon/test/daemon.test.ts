import type { AddressInfo } from "node:net";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { loadDaemonConfig } from "../src/config/load.js";
import { DeviceKeyStore } from "../src/crypto/keys.js";
import {
  SessionCipher,
  createSessionNonce,
  deriveSessionKeys,
  respondHandshake,
} from "../src/crypto/noise.js";
import { SessionImageUploadStore } from "../src/fs/image.js";
import { formatPairingSasLine } from "../src/pairing/responder.js";
import { DaemonSessionManager } from "../src/sessions/manager.js";
import { toBase64Url } from "../src/lib/base64url.js";
import { PairingSlotManager, getSas } from "../src/pairing/code.js";
import { DaemonConnection } from "../src/transport/connection.js";
import { createDaemonMessageRouter } from "../src/transport/message-router.js";
import { PairingTransportKeyStore } from "../src/transport/pairing-key-store.js";

function decodeMaybeEnvelope(raw: unknown) {
  const parsed = raw as Record<string, unknown>;
  if (
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.ciphertext === "string"
  ) {
    try {
      return JSON.parse(
        Buffer.from(parsed.ciphertext, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
    } catch {
      return parsed;
    }
  }
  return parsed;
}

function createMessageReader(socket: import("ws").WebSocket) {
  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];

  socket.on("message", (raw) => {
    const parsed = decodeMaybeEnvelope(JSON.parse(raw.toString()) as unknown);
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

function nextRawEnvelope(
  socket: import("ws").WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: Buffer) => {
      const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(parsed)) {
        return;
      }
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
      resolve(parsed);
    };
    const onClose = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error("socket closed"));
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
      reject(error);
    };

    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

function exportOkpPublicKeyBase64Url(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  if (typeof jwk.x !== "string" || jwk.x.length === 0) {
    throw new Error("public key is missing x coordinate");
  }
  return jwk.x;
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

  it("uses HELLOBUG_DAEMON_CONFIG_PATH when configPath is omitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-config-env-"));
    const file = join(dir, "daemon.json");
    await writeFile(
      file,
      JSON.stringify({
        server_url: "ws://localhost:3000/v1/relay",
        bootstrap_token: "bootstrap-token",
      }),
    );

    process.env.HELLOBUG_DAEMON_CONFIG_PATH = file;
    try {
      const config = await loadDaemonConfig();
      expect(config.bootstrap_token).toBe("bootstrap-token");
    } finally {
      delete process.env.HELLOBUG_DAEMON_CONFIG_PATH;
    }
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
    expect(
      Buffer.from(first.ed25519PublicKeyBase64Url, "base64url"),
    ).toHaveLength(32);
    expect(
      Buffer.from(first.x25519PublicKeyBase64Url, "base64url"),
    ).toHaveLength(32);
  });

  it("issues and consumes pairing slots", () => {
    const slots = new PairingSlotManager();
    const slot = slots.issuePairingSlot(60_000);

    expect(slots.findByCode(slot.pairing_code)?.pairing_id).toBe(
      slot.pairing_id,
    );
    expect(slots.consumePairingSlot(slot.pairing_id)?.pairing_code).toBe(
      slot.pairing_code,
    );
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
    const appNoiseIdentity = generateKeyPairSync("x25519");
    const appSigningIdentity = generateKeyPairSync("ed25519");
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
          app_pubkey: exportOkpPublicKeyBase64Url(appNoiseIdentity.publicKey),
          app_ed25519_pubkey: exportOkpPublicKeyBase64Url(
            appSigningIdentity.publicKey,
          ),
          app_device_name: "Test iPhone",
        },
      }),
    );

    const sas = await messages.next("device.pair.sas");
    expect(sas.payload.sas).toHaveLength(5);
    expect(sas.payload.noise_handshake).toBeTypeOf("string");
    expect(sas.payload.daemon_pubkey).toBe(identity.x25519PublicKeyBase64Url);
    expect(sas.payload.daemon_ed25519_pubkey).toBe(
      identity.ed25519PublicKeyBase64Url,
    );
    expect(sas.payload.machine_name).toBeTypeOf("string");
    expect(sas.payload.os).toBeTypeOf("string");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("completes a pending pairing handshake when the app confirms SAS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const appNoiseIdentity = generateKeyPairSync("x25519");
    const appSigningIdentity = generateKeyPairSync("ed25519");
    let resolved = false;
    let resolveConfirmed!: () => void;
    const confirmed = new Promise<void>((resolve) => {
      resolveConfirmed = () => {
        resolved = true;
        resolve();
      };
    });
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
          onPairingConfirmed: () => resolveConfirmed(),
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;
    await messages.next("daemon.hello");

    socket.send(
      JSON.stringify({
        type: "device.pair",
        payload: {
          pairing_code: "428791",
          server_url: serverUrl,
          app_pubkey: exportOkpPublicKeyBase64Url(appNoiseIdentity.publicKey),
          app_ed25519_pubkey: exportOkpPublicKeyBase64Url(
            appSigningIdentity.publicKey,
          ),
          app_device_name: "Confirm iPhone",
        },
      }),
    );

    const sas = await messages.next("device.pair.sas");
    const responded = respondHandshake({
      localStaticPrivateKey: appNoiseIdentity.privateKey,
      localStaticPublicKey: Buffer.from(
        exportOkpPublicKeyBase64Url(appNoiseIdentity.publicKey),
        "base64url",
      ),
      remoteStaticPublicKey: Buffer.from(
        sas.payload.daemon_pubkey,
        "base64url",
      ),
      localEphemeralPrivateKey: generateKeyPairSync("x25519").privateKey,
      message: Buffer.from(sas.payload.noise_handshake, "base64url"),
    });

    socket.send(
      JSON.stringify({
        type: "device.pair.confirm",
        payload: {
          confirmed: true,
          noise_handshake: responded.message.toString("base64url"),
        },
      }),
    );

    await confirmed;
    expect(resolved).toBe(true);

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("bootstraps the first encrypted session from pairing-derived transport keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-keys-"));
    const file = join(dir, "device.key");
    const identity = await new DeviceKeyStore(file).loadOrCreate();
    const pairingTransportKeys = new PairingTransportKeyStore(
      join(dir, "pairing-transport-keys.json"),
    );
    await pairingTransportKeys.load();
    const appNoiseIdentity = generateKeyPairSync("x25519");
    const appSigningIdentity = generateKeyPairSync("ed25519");
    let resolveConfirmed!: () => void;
    const confirmed = new Promise<void>((resolve) => {
      resolveConfirmed = resolve;
    });
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
      pairingTransportKeys,
      handlers: {
        onMessage: createDaemonMessageRouter({
          identity,
          pairingTransportKeys,
          sessions: new DaemonSessionManager({
            sendMessage: (message) => {
              connection.sendMessage(message);
            },
            allowedPaths: ["/tmp/workspace"],
          }),
          onPairingConfirmed: () => resolveConfirmed(),
        }),
      },
    });

    await connection.connect();
    const { socket, messages } = await connectionPromise;
    await messages.next("daemon.hello");

    const appPublicJwk = appNoiseIdentity.publicKey.export({
      format: "jwk",
    }) as JsonWebKey;
    const appSigningJwk = appSigningIdentity.publicKey.export({
      format: "jwk",
    }) as JsonWebKey;
    if (typeof appPublicJwk.x !== "string") {
      throw new Error("Missing app X25519 public key");
    }
    if (typeof appSigningJwk.x !== "string") {
      throw new Error("Missing app Ed25519 public key");
    }

    socket.send(
      JSON.stringify({
        type: "device.pair",
        payload: {
          pairing_code: "428791",
          server_url: serverUrl,
          app_pubkey: appPublicJwk.x,
          app_ed25519_pubkey: appSigningJwk.x,
          app_device_name: "Bootstrap iPhone",
        },
      }),
    );

    const sas = await messages.next("device.pair.sas");
    const responded = respondHandshake({
      localStaticPrivateKey: appNoiseIdentity.privateKey,
      localStaticPublicKey: Buffer.from(appPublicJwk.x, "base64url"),
      remoteStaticPublicKey: Buffer.from(
        sas.payload.daemon_pubkey,
        "base64url",
      ),
      localEphemeralPrivateKey: generateKeyPairSync("x25519").privateKey,
      message: Buffer.from(sas.payload.noise_handshake, "base64url"),
    });

    socket.send(
      JSON.stringify({
        type: "device.pair.confirm",
        payload: {
          confirmed: true,
          noise_handshake: responded.message.toString("base64url"),
        },
      }),
    );

    await confirmed;
    const storedKeys = pairingTransportKeys.get(appPublicJwk.x);
    expect(storedKeys).not.toBeNull();
    expect(storedKeys!.recvKey.toString("hex")).toBe(
      responded.keys.sendKey.toString("hex"),
    );
    expect(storedKeys.sendKey.toString("hex")).toBe(
      responded.keys.recvKey.toString("hex"),
    );

    const appCipher = new SessionCipher({
      sendKey: responded.keys.sendKey,
      recvKey: responded.keys.recvKey,
    });
    const sessionId = "session-pairing-bootstrap-1";
    const encrypt = (message: Record<string, unknown>, seq: number) =>
      appCipher
        .encrypt(
          Buffer.from(JSON.stringify(message), "utf8"),
          createSessionNonce(sessionId, seq),
        )
        .toString("base64url");

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 41,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "start-pairing-1",
            type: "session.start",
            payload: {
              session_id: sessionId,
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
          41,
        ),
        message_type: "session.start",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const startResultEnvelope = await nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.start.result",
    );
    const startResultPlaintext = appCipher.decrypt(
      Buffer.from(String(startResultEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(startResultEnvelope.seq)),
    );
    const startResult = JSON.parse(startResultPlaintext.toString("utf8")) as {
      type: string;
      payload: {
        status: string;
        workspace_path: string;
      };
    };
    expect(startResult.type).toBe("session.start.result");
    expect(startResult.payload.status).toBe("started");
    expect(startResult.payload.workspace_path).toBe("/tmp/workspace");

    const encryptedResponsePromise = nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.event",
    );

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 42,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "input-pairing-1",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "hello pairing bootstrap",
            },
          },
          42,
        ),
        message_type: "session.input",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const encryptedEnvelope = await encryptedResponsePromise;
    const plaintext = appCipher.decrypt(
      Buffer.from(String(encryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(encryptedEnvelope.seq)),
    );
    const inner = JSON.parse(plaintext.toString("utf8")) as {
      type: string;
      payload: {
        session_id: string;
        event: {
          event_type: string;
          text?: string;
        };
      };
    };

    expect(inner.type).toBe("session.event");
    expect(inner.payload.session_id).toBe(sessionId);
    expect(inner.payload.event.event_type).toBe("assistant.delta");
    expect(inner.payload.event.text).toBe("echo: hello pairing bootstrap");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("formats SAS for terminal display", () => {
    expect(
      formatPairingSasLine({
        v: 1,
        type: "device.pair.sas",
        payload: {
          sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
          daemon_pubkey: "daemon-pubkey",
          daemon_ed25519_pubkey: "daemon-ed25519-pubkey",
          machine_name: "CI-Mac",
          os: "darwin",
        },
      }),
    ).toBe("🐢 🪐 🍵 🎷 🌙");
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

    const startResult = await messages.next("session.start.result");
    expect(startResult.payload.status).toBe("started");
    expect(startResult.payload.workspace_path).toBe("/tmp/workspace");

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

    const startResult = await messages.next("session.start.result");
    expect(startResult.payload.status).toBe("started");

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

  it("decrypts encrypted app session messages and encrypts session events back to the app", async () => {
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

    const appKeyPair = generateKeyPairSync("x25519");
    const appPublicJwk = appKeyPair.publicKey.export({
      format: "jwk",
    }) as JsonWebKey;
    if (typeof appPublicJwk.x !== "string") {
      throw new Error("Missing app X25519 public key");
    }

    const appCipher = new SessionCipher(
      deriveSessionKeys({
        role: "initiator",
        localPrivateKey: appKeyPair.privateKey,
        localPublicKeyBase64Url: appPublicJwk.x,
        remotePublicKeyBase64Url: identity.x25519PublicKeyBase64Url,
      }),
    );
    const sessionId = "session-encrypted-1";
    const encrypt = (message: Record<string, unknown>, seq: number) => {
      const nonce = createSessionNonce(sessionId, seq);
      return appCipher
        .encrypt(Buffer.from(JSON.stringify(message), "utf8"), nonce)
        .toString("base64url");
    };

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 11,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "start-enc-1",
            type: "session.start",
            payload: {
              session_id: sessionId,
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
          11,
        ),
        message_type: "session.start",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const startResultEnvelope = await nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.start.result",
    );
    const startResultPlaintext = appCipher.decrypt(
      Buffer.from(String(startResultEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(startResultEnvelope.seq)),
    );
    const startResult = JSON.parse(startResultPlaintext.toString("utf8")) as {
      type: string;
      payload: {
        status: string;
      };
    };
    expect(startResult.type).toBe("session.start.result");
    expect(startResult.payload.status).toBe("started");

    const encryptedResponsePromise = nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.event",
    );

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 12,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "input-enc-1",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "hello encrypted daemon",
            },
          },
          12,
        ),
        message_type: "session.input",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const encryptedEnvelope = await encryptedResponsePromise;
    expect(encryptedEnvelope.message_type).toBe("session.event");
    expect(encryptedEnvelope.cipher_mode).toBe("noise_static_v1");

    const plaintext = appCipher.decrypt(
      Buffer.from(String(encryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(encryptedEnvelope.seq)),
    );
    const inner = JSON.parse(plaintext.toString("utf8")) as {
      type: string;
      payload: {
        session_id: string;
        event: {
          event_type: string;
          text?: string;
        };
      };
    };

    expect(inner.type).toBe("session.event");
    expect(inner.payload.session_id).toBe(sessionId);
    expect(inner.payload.event.event_type).toBe("assistant.delta");
    expect(inner.payload.event.text).toBe("echo: hello encrypted daemon");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("emits key.ratchet and continues encrypted traffic after key.ratchet_ack", async () => {
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
      ratchetMessageLimit: 3,
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

    const appKeyPair = generateKeyPairSync("x25519");
    const appPublicJwk = appKeyPair.publicKey.export({
      format: "jwk",
    }) as JsonWebKey;
    if (typeof appPublicJwk.x !== "string") {
      throw new Error("Missing app X25519 public key");
    }

    let activeAppCipher = new SessionCipher(
      deriveSessionKeys({
        role: "initiator",
        localPrivateKey: appKeyPair.privateKey,
        localPublicKeyBase64Url: appPublicJwk.x,
        remotePublicKeyBase64Url: identity.x25519PublicKeyBase64Url,
      }),
    );

    const sessionId = "session-ratchet-daemon-1";
    const encrypt = (
      message: Record<string, unknown>,
      seq: number,
      cipher: SessionCipher = activeAppCipher,
    ) => {
      const nonce = createSessionNonce(sessionId, seq);
      return cipher
        .encrypt(Buffer.from(JSON.stringify(message), "utf8"), nonce)
        .toString("base64url");
    };

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 31,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "start-ratchet-1",
            type: "session.start",
            payload: {
              session_id: sessionId,
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
          31,
        ),
        message_type: "session.start",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const startResultEnvelope = await nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.start.result",
    );
    const startResultPlaintext = activeAppCipher.decrypt(
      Buffer.from(String(startResultEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(startResultEnvelope.seq)),
    );
    const startResult = JSON.parse(startResultPlaintext.toString("utf8")) as {
      payload: {
        status: string;
      };
    };
    expect(startResult.payload.status).toBe("started");

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 32,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "input-ratchet-1",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "before ratchet",
            },
          },
          32,
        ),
        message_type: "session.input",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const firstEncryptedEnvelope = await nextRawEnvelope(
      socket,
      (message) => message.cipher_mode === "noise_static_v1",
    );
    expect(firstEncryptedEnvelope.message_type).toBe("session.event");
    const firstPlaintext = activeAppCipher.decrypt(
      Buffer.from(String(firstEncryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(firstEncryptedEnvelope.seq)),
    );
    const firstInner = JSON.parse(firstPlaintext.toString("utf8")) as {
      payload: {
        event: {
          text?: string;
        };
      };
    };
    expect(firstInner.payload.event.text).toBe("echo: before ratchet");

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 33,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "input-ratchet-2",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "trigger ratchet",
            },
          },
          33,
        ),
        message_type: "session.input",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const secondEncryptedEnvelope = await nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.event",
    );
    const secondPlaintextBeforeRatchet = activeAppCipher.decrypt(
      Buffer.from(String(secondEncryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(secondEncryptedEnvelope.seq)),
    );
    const secondInnerBeforeRatchet = JSON.parse(
      secondPlaintextBeforeRatchet.toString("utf8"),
    ) as {
      payload: {
        event: {
          text?: string;
        };
      };
    };
    expect(secondInnerBeforeRatchet.payload.event.text).toBe(
      "echo: trigger ratchet",
    );

    const thirdEncryptedEnvelopePromise = nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.event",
    );

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 34,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "input-ratchet-3",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "during ratchet",
            },
          },
          34,
        ),
        message_type: "session.input",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const ratchetMessage = (await messages.next("key.ratchet")) as {
      type: string;
      session_id?: string;
      next_pubkey?: string;
      payload?: {
        session_id?: string;
        next_pubkey?: string;
      };
    };
    const ratchetSessionId =
      ratchetMessage.payload?.session_id ?? ratchetMessage.session_id;
    const ratchetNextPubkey =
      ratchetMessage.payload?.next_pubkey ?? ratchetMessage.next_pubkey;
    expect(ratchetMessage.type).toBe("key.ratchet");
    expect(ratchetSessionId).toBe(sessionId);
    expect(ratchetNextPubkey).toBeTypeOf("string");

    activeAppCipher = new SessionCipher(
      deriveSessionKeys({
        role: "responder",
        localPrivateKey: appKeyPair.privateKey,
        localPublicKeyBase64Url: appPublicJwk.x,
        remotePublicKeyBase64Url: ratchetNextPubkey!,
      }),
    );

    socket.send(
      JSON.stringify({
        id: "ratchet-ack-1",
        type: "key.ratchet_ack",
        payload: {
          session_id: sessionId,
        },
      }),
    );

    const thirdEncryptedEnvelope = await thirdEncryptedEnvelopePromise;
    const thirdPlaintext = activeAppCipher.decrypt(
      Buffer.from(String(thirdEncryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(thirdEncryptedEnvelope.seq)),
    );
    const thirdInner = JSON.parse(thirdPlaintext.toString("utf8")) as {
      type: string;
      payload: {
        event: {
          text?: string;
        };
      };
    };
    expect(thirdInner.type).toBe("session.event");
    expect(thirdInner.payload.event.text).toBe("echo: during ratchet");

    const fourthEncryptedEnvelopePromise = nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.event",
    );

    socket.send(
      JSON.stringify({
        from: "app-device-1",
        to: "",
        session_id: sessionId,
        seq: 35,
        ts: Date.now(),
        sig: "signature",
        ciphertext: encrypt(
          {
            id: "input-ratchet-4",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "after ratchet",
            },
          },
          35,
        ),
        message_type: "session.input",
        cipher_mode: "noise_static_v1",
        sender_pubkey: appPublicJwk.x,
      }),
    );

    const fourthEncryptedEnvelope = await fourthEncryptedEnvelopePromise;
    const fourthPlaintext = activeAppCipher.decrypt(
      Buffer.from(String(fourthEncryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(fourthEncryptedEnvelope.seq)),
    );
    const fourthInner = JSON.parse(fourthPlaintext.toString("utf8")) as {
      type: string;
      payload: {
        event: {
          text?: string;
        };
      };
    };
    expect(fourthInner.type).toBe("session.event");
    expect(fourthInner.payload.event.text).toBe("echo: after ratchet");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("accepts app-initiated key.ratchet and continues encrypted traffic after ack", async () => {
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

    const appKeyPair = generateKeyPairSync("x25519");
    const appPublicJwk = appKeyPair.publicKey.export({
      format: "jwk",
    }) as JsonWebKey;
    if (typeof appPublicJwk.x !== "string") {
      throw new Error("Missing app X25519 public key");
    }

    let activeAppCipher = new SessionCipher(
      deriveSessionKeys({
        role: "initiator",
        localPrivateKey: appKeyPair.privateKey,
        localPublicKeyBase64Url: appPublicJwk.x,
        remotePublicKeyBase64Url: identity.x25519PublicKeyBase64Url,
      }),
    );

    const sessionId = "session-ratchet-app-1";
    const encrypt = (
      message: Record<string, unknown>,
      seq: number,
      cipher: SessionCipher = activeAppCipher,
      senderPubkey: string = appPublicJwk.x,
    ) => ({
      from: "app-device-1",
      to: "",
      session_id: sessionId,
      seq,
      ts: Date.now(),
      sig: "signature",
      ciphertext: cipher
        .encrypt(
          Buffer.from(JSON.stringify(message), "utf8"),
          createSessionNonce(sessionId, seq),
        )
        .toString("base64url"),
      message_type: String(message.type),
      cipher_mode: "noise_static_v1",
      sender_pubkey: senderPubkey,
    });

    socket.send(
      JSON.stringify(
        encrypt(
          {
            id: "start-app-ratchet-1",
            type: "session.start",
            payload: {
              session_id: sessionId,
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
          51,
        ),
      ),
    );

    const startResultEnvelope = await nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.start.result",
    );
    const startResultPlaintext = activeAppCipher.decrypt(
      Buffer.from(String(startResultEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(startResultEnvelope.seq)),
    );
    const startResult = JSON.parse(startResultPlaintext.toString("utf8")) as {
      payload: {
        status: string;
      };
    };
    expect(startResult.payload.status).toBe("started");

    const firstEncryptedEnvelopePromise = nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.event",
    );

    socket.send(
      JSON.stringify(
        encrypt(
          {
            id: "input-app-ratchet-1",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "before app ratchet",
            },
          },
          52,
        ),
      ),
    );

    const firstEncryptedEnvelope = await firstEncryptedEnvelopePromise;
    const firstPlaintext = activeAppCipher.decrypt(
      Buffer.from(String(firstEncryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(firstEncryptedEnvelope.seq)),
    );
    const firstInner = JSON.parse(firstPlaintext.toString("utf8")) as {
      payload: {
        event: {
          text?: string;
        };
      };
    };
    expect(firstInner.payload.event.text).toBe("echo: before app ratchet");

    const nextAppKeyPair = generateKeyPairSync("x25519");
    const nextAppPublicJwk = nextAppKeyPair.publicKey.export({
      format: "jwk",
    }) as JsonWebKey;
    if (typeof nextAppPublicJwk.x !== "string") {
      throw new Error("Missing next app X25519 public key");
    }

    const secondEncryptedEnvelopePromise = nextRawEnvelope(
      socket,
      (message) =>
        message.cipher_mode === "noise_static_v1" &&
        message.message_type === "session.event",
    );

    socket.send(
      JSON.stringify({
        id: "app-ratchet-1",
        type: "key.ratchet",
        payload: {
          session_id: sessionId,
          next_pubkey: nextAppPublicJwk.x,
        },
      }),
    );

    const ratchetAck = await messages.next("key.ratchet_ack");
    expect(ratchetAck.payload.session_id).toBe(sessionId);

    activeAppCipher = new SessionCipher(
      deriveSessionKeys({
        role: "initiator",
        localPrivateKey: nextAppKeyPair.privateKey,
        localPublicKeyBase64Url: nextAppPublicJwk.x,
        remotePublicKeyBase64Url: identity.x25519PublicKeyBase64Url,
      }),
    );

    socket.send(
      JSON.stringify(
        encrypt(
          {
            id: "input-app-ratchet-2",
            type: "session.input",
            payload: {
              session_id: sessionId,
              text: "after app ratchet",
            },
          },
          53,
          activeAppCipher,
          nextAppPublicJwk.x,
        ),
      ),
    );

    const secondEncryptedEnvelope = await secondEncryptedEnvelopePromise;
    const secondPlaintext = activeAppCipher.decrypt(
      Buffer.from(String(secondEncryptedEnvelope.ciphertext), "base64url"),
      createSessionNonce(sessionId, Number(secondEncryptedEnvelope.seq)),
    );
    const secondInner = JSON.parse(secondPlaintext.toString("utf8")) as {
      payload: {
        event: {
          text?: string;
        };
      };
    };
    expect(secondInner.payload.event.text).toBe("echo: after app ratchet");

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

    const startResult = await messages.next("session.start.result");
    expect(startResult.payload.status).toBe("started");

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

    const startResult = await messages.next("session.start.result");
    expect(startResult.payload.request_id).toBe("start-forbidden-1");
    expect(startResult.payload.status).toBe("rejected");
    expect(startResult.payload.code).toBe("WORKSPACE_FORBIDDEN");

    await connection.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });
});
