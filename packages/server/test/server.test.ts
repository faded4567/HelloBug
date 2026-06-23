import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { buildServer } from "../src/app.js";
import { ServerStateStore } from "../src/lib/state-store.js";
import { RelayReplayBuffer } from "../src/relay/buffer.js";

function createMessageReader(socket: WebSocket) {
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

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (
      socket.readyState === WebSocket.CLOSING ||
      socket.readyState === WebSocket.CLOSED
    ) {
      resolve();
      return;
    }

    socket.once("close", () => resolve());
    socket.close();
  });
}

function encodeEnvelope(
  message: Record<string, unknown>,
  options: {
    from?: string;
    to?: string;
    sessionId?: string;
    seq?: number;
  } = {},
): string {
  return JSON.stringify({
    from: options.from ?? "app-device",
    to: options.to ?? "",
    session_id: options.sessionId ?? "",
    seq: options.seq ?? 1,
    ts: Date.now(),
    sig: "",
    ciphertext: Buffer.from(JSON.stringify(message), "utf8").toString("base64url"),
  });
}

function decodeEnvelope(raw: any): { envelope: any; message: any } {
  return {
    envelope: raw,
    message: JSON.parse(Buffer.from(raw.ciphertext, "base64url").toString("utf8")),
  };
}

async function nextEnvelopeMessage(
  reader: ReturnType<typeof createMessageReader>,
  type?: string,
): Promise<{ envelope: any; message: any }> {
  while (true) {
    const raw = await reader.next();
    if (!raw || typeof raw !== "object" || !("ciphertext" in raw)) {
      continue;
    }

    const decoded = decodeEnvelope(raw);
    if (!type || decoded.message.type === type) {
      return decoded;
    }
  }
}

describe("server skeleton", () => {
  it("responds to /health", async () => {
    const { app } = await buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it("issues bootstrap tokens from the admin route when enabled", async () => {
    const { app } = await buildServer({
      bootstrapAdminToken: "debug-secret",
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/admin/bootstrap-token",
    });
    expect(unauthorized.statusCode).toBe(401);

    const issued = await app.inject({
      method: "POST",
      url: "/v1/admin/bootstrap-token",
      headers: {
        "x-admin-token": "debug-secret",
      },
      payload: {
        ttl_ms: 60_000,
      },
    });

    expect(issued.statusCode).toBe(201);
    const body = issued.json();
    expect(body.token).toBeTypeOf("string");
    expect(body.expires_at).toBeGreaterThan(Date.now());
    await app.close();
  });

  it("registers a daemon with a valid bootstrap token", async () => {
    const { app, services } = await buildServer();
    const issued = services.bootstrapTokens.issueToken();

    const response = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key",
        bootstrap_token: issued.token,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.device_id).toBeTypeOf("string");
    expect(body.cert).toContain("BEGIN CERTIFICATE");
    expect(body.ca_cert).toContain("BEGIN CERTIFICATE");
    await app.close();
  });

  it("rejects a reused bootstrap token", async () => {
    const { app, services } = await buildServer();
    const issued = services.bootstrapTokens.issueToken();

    await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key",
        bootstrap_token: issued.token,
      },
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-2",
        bootstrap_token: issued.token,
      },
    });

    expect(second.statusCode).toBe(401);
    expect(second.json().reason).toBe("used");
    await app.close();
  });

  it("keeps daemon registrations across server restarts", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "hellobug-server-test-"));
    const stateStore = new ServerStateStore(join(stateDir, "server-state.json"));

    const first = await buildServer({
      jwtSecret: "restart-secret",
      stateStore,
    });
    const bootstrap = first.services.bootstrapTokens.issueToken();
    await first.services.persistState();

    const registered = await first.app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "restart-device-pub-key",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();
    await first.app.close();

    const second = await buildServer({
      jwtSecret: "different-secret-that-should-not-apply",
      stateStore,
    });

    await second.app.listen({ host: "127.0.0.1", port: 0 });
    const address = second.app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");

    daemonSocket.send(
      JSON.stringify({
        type: "daemon.hello",
        payload: {
          device_id: daemonDevice.device_id,
          daemon_version: "0.1.0",
          supported_features: ["e2ee_noise_ik", "multi_session"],
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(daemonSocket.readyState).toBe(WebSocket.OPEN);
    expect(second.services.deviceRegistry.getDaemonDevice(daemonDevice.device_id)).toBeTruthy();

    await closeSocket(daemonSocket);
    await second.app.close();
  });

  it("stores push tokens for authenticated app devices", async () => {
    const { app, services } = await buildServer({
      jwtSecret: "push-token-secret",
    });

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: "daemon-1",
      appPubKey: "app-pub-key",
      appEd25519PubKey: "app-ed25519-pub-key",
      appDeviceName: "Test iPhone",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope({
        v: 1,
        id: "auth-attach-1",
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );

    await nextEnvelopeMessage(appMessages, "auth.token");

    appSocket.send(
      encodeEnvelope({
        v: 1,
        id: "push-token-1",
        type: "device.push_token",
        payload: {
          platform: "ios",
          apns_token: "abcd1234",
          manufacturer: null,
          vendor_token: null,
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(services.deviceRegistry.getAppDevice(appDevice.deviceId)).toMatchObject({
      deviceId: appDevice.deviceId,
      pushPlatform: "ios",
      apnsToken: "abcd1234",
    });

    await closeSocket(appSocket);
    await app.close();
  });

  it("relays pairing, auth, session traffic, and presence updates", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");

    daemonSocket.send(
      JSON.stringify({
        type: "daemon.hello",
        payload: {
          device_id: daemonDevice.device_id,
          daemon_version: "0.1.0",
          supported_features: ["e2ee_noise_ik", "multi_session"],
        },
      }),
    );
    daemonSocket.send(
      JSON.stringify({
        type: "device.pair.ready",
        payload: {
          pairing_id: "pairing-1",
          pairing_code: "428791",
          expires_at: Date.now() + 30_000,
        },
      }),
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      JSON.stringify({
        type: "device.pair",
        payload: {
          pairing_code: "428791",
          server_url: relayUrl,
          app_pubkey: "app-pub-key",
          app_ed25519_pubkey: "app-ed25519-pub-key",
          app_device_name: "Test iPhone",
        },
      }),
    );

    const forwardedPair = await daemonMessages.next("device.pair");
    expect(forwardedPair.payload.app_device_name).toBe("Test iPhone");

    daemonSocket.send(
      JSON.stringify({
        type: "device.pair.sas",
        payload: {
          sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
          daemon_pubkey: "daemon-pub-key",
          daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
          machine_name: "CI-Mac",
          os: "darwin",
        },
      }),
    );

    const sas = await appMessages.next("device.pair.sas");
    expect(sas.payload.machine_name).toBe("CI-Mac");

    appSocket.send(
      JSON.stringify({
        type: "device.pair.confirm",
        payload: {
          confirmed: true,
        },
      }),
    );

    const forwardedConfirm = await daemonMessages.next("device.pair.confirm");
    expect(forwardedConfirm.payload.confirmed).toBe(true);

    const authToken = await appMessages.next("auth.token");
    expect(authToken.payload.jwt).toBeTypeOf("string");

    const onlineStatus = await appMessages.next("device.status");
    expect(onlineStatus.payload.online).toBe(true);
    expect(onlineStatus.payload.machine_name).toBe("CI-Mac");

    appSocket.send(
      JSON.stringify({
        type: "session.start",
        payload: {
          session_id: "session-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      }),
    );

    const forwardedStart = await daemonMessages.next("session.start");
    expect(forwardedStart.payload.session_id).toBe("session-1");

    daemonSocket.send(
      JSON.stringify({
        type: "session.event",
        payload: {
          session_id: "session-1",
          agent_id: null,
          agent_type: null,
          seq: 1,
          event: {
            event_type: "assistant.delta",
            text: "hello from daemon",
          },
        },
      }),
    );

    const sessionEvent = await appMessages.next("session.event");
    expect(sessionEvent.payload.event.text).toBe("hello from daemon");

    daemonSocket.close();
    const offlineStatus = await appMessages.next("device.status");
    expect(offlineStatus.payload.online).toBe(false);
    expect(offlineStatus.payload.machine_name).toBe("CI-Mac");

    await closeSocket(appSocket);
    await app.close();
  });

  it("replays missing session events after app reconnects", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");

    daemonSocket.send(
      JSON.stringify({
        type: "daemon.hello",
        payload: {
          device_id: daemonDevice.device_id,
          daemon_version: "0.1.0",
          supported_features: ["e2ee_noise_ik", "multi_session"],
        },
      }),
    );
    daemonSocket.send(
      JSON.stringify({
        type: "device.pair.ready",
        payload: {
          pairing_id: "pairing-2",
          pairing_code: "593274",
          expires_at: Date.now() + 30_000,
        },
      }),
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      JSON.stringify({
        type: "device.pair",
        payload: {
          pairing_code: "593274",
          server_url: relayUrl,
          app_pubkey: "app-pub-key",
          app_ed25519_pubkey: "app-ed25519-pub-key",
          app_device_name: "Replay iPhone",
        },
      }),
    );

    await daemonMessages.next("device.pair");

    daemonSocket.send(
      JSON.stringify({
        type: "device.pair.sas",
        payload: {
          sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
          daemon_pubkey: "daemon-pub-key",
          daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
          machine_name: "Replay-Mac",
          os: "darwin",
        },
      }),
    );

    await appMessages.next("device.pair.sas");

    appSocket.send(
      JSON.stringify({
        type: "device.pair.confirm",
        payload: {
          confirmed: true,
        },
      }),
    );

    await daemonMessages.next("device.pair.confirm");
    const authToken = await appMessages.next("auth.token");
    await appMessages.next("device.status");

    appSocket.send(
      JSON.stringify({
        type: "session.start",
        payload: {
          session_id: "session-replay-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      }),
    );

    await daemonMessages.next("session.start");

    daemonSocket.send(
      JSON.stringify({
        type: "session.event",
        payload: {
          session_id: "session-replay-1",
          agent_id: null,
          agent_type: null,
          seq: 1,
          event: {
            event_type: "assistant.delta",
            text: "first chunk",
          },
        },
      }),
    );

    const firstEvent = await appMessages.next("session.event");
    expect(firstEvent.payload.seq).toBe(1);

    await closeSocket(appSocket);

    daemonSocket.send(
      JSON.stringify({
        type: "session.event",
        payload: {
          session_id: "session-replay-1",
          agent_id: null,
          agent_type: null,
          seq: 2,
          event: {
            event_type: "assistant.delta",
            text: "second chunk",
          },
        },
      }),
    );
    daemonSocket.send(
      JSON.stringify({
        type: "session.event",
        payload: {
          session_id: "session-replay-1",
          agent_id: null,
          agent_type: null,
          seq: 3,
          event: {
            event_type: "assistant.delta",
            text: "third chunk",
          },
        },
      }),
    );

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    resumedSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: authToken.payload.jwt,
        },
      }),
    );

    await resumedMessages.next("auth.token");
    await resumedMessages.next("device.status");

    resumedSocket.send(
      JSON.stringify({
        type: "session.resume",
        payload: {
          session_id: "session-replay-1",
          last_seq: 1,
        },
      }),
    );

    const replayedSecond = await resumedMessages.next("session.event");
    expect(replayedSecond.payload.seq).toBe(2);
    expect(replayedSecond.payload.event.text).toBe("second chunk");

    const replayedThird = await resumedMessages.next("session.event");
    expect(replayedThird.payload.seq).toBe(3);
    expect(replayedThird.payload.event.text).toBe("third chunk");

    const replayDone = await resumedMessages.next("replay.done");
    expect(replayDone.payload.session_id).toBe("session-replay-1");
    expect(replayDone.payload.replayed_count).toBe(2);
    expect(replayDone.payload.current_seq).toBe(3);

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("bridges envelope-framed app traffic for pairing and replay resume", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-envelope",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");

    daemonSocket.send(
      JSON.stringify({
        type: "daemon.hello",
        payload: {
          device_id: daemonDevice.device_id,
          daemon_version: "0.1.0",
          supported_features: ["e2ee_noise_ik", "multi_session"],
        },
      }),
    );
    daemonSocket.send(
      JSON.stringify({
        type: "device.pair.ready",
        payload: {
          pairing_id: "pairing-envelope-1",
          pairing_code: "771244",
          expires_at: Date.now() + 30_000,
        },
      }),
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope({
        v: 1,
        id: "pair-start-1",
        type: "device.pair",
        payload: {
          pairing_code: "771244",
          server_url: relayUrl,
          app_pubkey: "app-pub-key-envelope",
          app_ed25519_pubkey: "app-ed25519-pub-key-envelope",
          app_device_name: "Envelope iPhone",
        },
      }),
    );

    const forwardedPair = await daemonMessages.next("device.pair");
    expect(forwardedPair.payload.app_device_name).toBe("Envelope iPhone");

    daemonSocket.send(
      JSON.stringify({
        type: "device.pair.sas",
        payload: {
          sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
          daemon_pubkey: "daemon-pub-key",
          daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
          machine_name: "Envelope-Mac",
          os: "darwin",
        },
      }),
    );

    const sas = await nextEnvelopeMessage(appMessages, "device.pair.sas");
    expect(sas.message.payload.machine_name).toBe("Envelope-Mac");
    expect(sas.envelope.sig).toBe("");

    appSocket.send(
      encodeEnvelope({
        v: 1,
        id: "pair-confirm-1",
        type: "device.pair.confirm",
        payload: {
          confirmed: true,
        },
      }),
    );

    await daemonMessages.next("device.pair.confirm");
    const authToken = await nextEnvelopeMessage(appMessages, "auth.token");
    const onlineStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(authToken.message.payload.jwt).toBeTypeOf("string");
    expect(onlineStatus.message.payload.machine_name).toBe("Envelope-Mac");

    appSocket.send(
      encodeEnvelope({
        v: 1,
        id: "session-start-1",
        type: "session.start",
        payload: {
          session_id: "session-envelope-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      }),
    );

    await daemonMessages.next("session.start");

    daemonSocket.send(
      JSON.stringify({
        type: "session.event",
        payload: {
          session_id: "session-envelope-1",
          agent_id: null,
          agent_type: null,
          seq: 1,
          event: {
            event_type: "assistant.delta",
            text: "first envelope chunk",
          },
        },
      }),
    );

    const firstEvent = await nextEnvelopeMessage(appMessages, "session.event");
    expect(firstEvent.message.payload.seq).toBe(1);
    expect(firstEvent.envelope.seq).toBe(1);

    await closeSocket(appSocket);

    daemonSocket.send(
      JSON.stringify({
        type: "session.event",
        payload: {
          session_id: "session-envelope-1",
          agent_id: null,
          agent_type: null,
          seq: 2,
          event: {
            event_type: "assistant.delta",
            text: "second envelope chunk",
          },
        },
      }),
    );

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    resumedSocket.send(
      encodeEnvelope({
        v: 1,
        id: "auth-attach-1",
        type: "auth.attach",
        payload: {
          jwt: authToken.message.payload.jwt,
        },
      }),
    );

    await nextEnvelopeMessage(resumedMessages, "auth.token");
    await nextEnvelopeMessage(resumedMessages, "device.status");

    resumedSocket.send(
      encodeEnvelope({
        v: 1,
        id: "session-replay-1",
        type: "session.replay",
        payload: {
          session_id: "session-envelope-1",
          from_seq: 1,
        },
      }),
    );

    const replayedSecond = await nextEnvelopeMessage(resumedMessages, "session.event");
    expect(replayedSecond.message.payload.seq).toBe(2);
    expect(replayedSecond.message.payload.event.text).toBe("second envelope chunk");

    const replayDone = await nextEnvelopeMessage(resumedMessages, "replay.done");
    expect(replayDone.message.payload.session_id).toBe("session-envelope-1");
    expect(replayDone.message.payload.replayed_count).toBe(1);
    expect(replayDone.message.payload.current_seq).toBe(2);
    expect(replayDone.envelope.seq).toBe(2);

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("keeps only the newest buffered session events within capacity", () => {
    const buffer = new RelayReplayBuffer({
      capacity: 3,
      ttlMs: 24 * 60 * 60 * 1000,
      now: () => 1_000,
    });

    for (const seq of [1, 2, 3, 4]) {
      buffer.append({
        type: "session.event",
        payload: {
          session_id: "session-capacity-1",
          agent_id: null,
          agent_type: null,
          seq,
          event: {
            event_type: "assistant.delta",
            text: `chunk-${seq}`,
          },
        },
      });
    }

    const replay = buffer.replay("session-capacity-1", 0);
    expect(replay.messages.map((message) => message.payload.seq)).toEqual([2, 3, 4]);
    expect(replay.replayedCount).toBe(3);
    expect(replay.currentSeq).toBe(4);
    expect(buffer.getSessionSize("session-capacity-1")).toBe(3);
  });
});
