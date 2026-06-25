import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEnvelopeSigningPayload } from "@hellobug/protocol";
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

async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for condition");
}

function encodeEnvelope(
  message: Record<string, unknown>,
  options: {
    from?: string;
    to?: string;
    sessionId?: string;
    seq?: number;
    signingKey?: KeyObject;
  } = {},
): string {
  const envelope = {
    from: options.from ?? "app-device",
    to: options.to ?? "",
    session_id: options.sessionId ?? "",
    seq: options.seq ?? 1,
    ts: Date.now(),
    sig: "",
    ciphertext: Buffer.from(JSON.stringify(message), "utf8").toString(
      "base64url",
    ),
  };
  if (options.signingKey) {
    envelope.sig = sign(
      null,
      createEnvelopeSigningPayload(envelope),
      options.signingKey,
    ).toString("base64url");
  }
  return JSON.stringify(envelope);
}

function decodeEnvelope(raw: any): { envelope: any; message: any } {
  return {
    envelope: raw,
    message: JSON.parse(
      Buffer.from(raw.ciphertext, "base64url").toString("utf8"),
    ),
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

function createAppIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return {
    privateKey,
    publicKeyBase64Url: jwk.x,
  };
}

function createDaemonIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return {
    privateKey,
    publicKeyBase64Url: jwk.x,
  };
}

function parseJwtDeviceId(jwt: string): string {
  const parts = jwt.split(".");
  const payload = JSON.parse(
    Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
  ) as { device_id?: string };
  if (!payload.device_id) {
    throw new Error("JWT missing device_id");
  }
  return payload.device_id;
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
    const stateStore = new ServerStateStore(
      join(stateDir, "server-state.json"),
    );

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
    expect(
      second.services.deviceRegistry.getDaemonDevice(daemonDevice.device_id),
    ).toBeTruthy();

    await closeSocket(daemonSocket);
    await second.app.close();
  });

  it("stores push tokens for authenticated app devices", async () => {
    const { app, services } = await buildServer({
      jwtSecret: "push-token-secret",
    });
    const appIdentity = createAppIdentity();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: "daemon-1",
      appPubKey: "app-pub-key",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Test iPhone",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-1",
          type: "auth.attach",
          payload: {
            jwt: jwt.jwt,
          },
        },
        {
          from: appDevice.deviceId,
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(appMessages, "auth.token");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "push-token-1",
          type: "device.push_token",
          payload: {
            platform: "ios",
            apns_token: "abcd1234",
            manufacturer: null,
            vendor_token: null,
          },
        },
        {
          from: appDevice.deviceId,
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      services.deviceRegistry.getAppDevice(appDevice.deviceId),
    ).toMatchObject({
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
          noise_handshake: "noise-message-1",
          daemon_pubkey: "daemon-pub-key",
          daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
          machine_name: "CI-Mac",
          os: "darwin",
        },
      }),
    );

    const sas = await appMessages.next("device.pair.sas");
    expect(sas.payload.machine_name).toBe("CI-Mac");
    expect(sas.payload.noise_handshake).toBe("noise-message-1");

    appSocket.send(
      JSON.stringify({
        type: "device.pair.confirm",
        payload: {
          confirmed: true,
          noise_handshake: "noise-message-2",
        },
      }),
    );

    const forwardedConfirm = await daemonMessages.next("device.pair.confirm");
    expect(forwardedConfirm.payload.confirmed).toBe(true);
    expect(forwardedConfirm.payload.noise_handshake).toBe("noise-message-2");

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
        type: "session.start.result",
        payload: {
          request_id: forwardedStart.id,
          session_id: "session-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          status: "started",
          message: "Session started",
        },
      }),
    );

    const startResult = await appMessages.next("session.start.result");
    expect(startResult.payload.status).toBe("started");
    expect(startResult.payload.workspace_path).toBe("/tmp/workspace");

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
          noise_handshake: "noise-message-1",
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
          noise_handshake: "noise-message-2",
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

    const forwardedStart = await daemonMessages.next("session.start");
    daemonSocket.send(
      JSON.stringify({
        type: "session.start.result",
        payload: {
          request_id: forwardedStart.id,
          session_id: "session-replay-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          status: "started",
          message: "Session started",
        },
      }),
    );
    await appMessages.next("session.start.result");

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
    expect(replayDone.payload.status).toBe("ok");
    expect(replayDone.payload.message).toBe("Replay complete");

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("replays pending danger approvals after app reconnects", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-danger-replay",
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

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-danger-replay-pub",
      appEd25519PubKey: "app-danger-replay-ed25519",
      appDeviceName: "Danger Replay App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );
    await appMessages.next("auth.token");
    await appMessages.next("device.status");

    services.sessionRegistry.register(
      "session-danger-replay-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    await closeSocket(appSocket);

    const timeoutAt = Date.now() + 60_000;
    daemonSocket.send(
      JSON.stringify({
        type: "danger.pending",
        payload: {
          danger_id: "danger-replay-1",
          session_id: "session-danger-replay-1",
          agent_id: null,
          agent_type: null,
          command: "rm -rf /tmp/demo",
          tool_name: "bash",
          rule_matched: "dangerous bash",
          workspace: "/tmp/workspace",
          timeout_at: timeoutAt,
        },
      }),
    );

    await waitFor(() => services.pendingDangers.getSize() === 1);

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    resumedSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );

    await resumedMessages.next("auth.token");
    await resumedMessages.next("device.status");

    const pending = await resumedMessages.next("danger.pending");
    expect(pending.payload.danger_id).toBe("danger-replay-1");
    expect(pending.payload.session_id).toBe("session-danger-replay-1");
    expect(pending.payload.tool_name).toBe("bash");
    expect(pending.payload.command).toBe("rm -rf /tmp/demo");
    expect(pending.payload.timeout_at).toBe(timeoutAt);

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("does not replay resolved pending danger approvals after reconnect", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-danger-resolved",
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

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-danger-resolved-pub",
      appEd25519PubKey: "app-danger-resolved-ed25519",
      appDeviceName: "Danger Resolved App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );
    await appMessages.next("auth.token");
    await appMessages.next("device.status");

    services.sessionRegistry.register(
      "session-danger-resolved-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      JSON.stringify({
        type: "danger.pending",
        payload: {
          danger_id: "danger-resolved-1",
          session_id: "session-danger-resolved-1",
          agent_id: null,
          agent_type: null,
          command: "sudo rm -rf /",
          tool_name: "bash",
          rule_matched: "dangerous bash",
          workspace: "/tmp/workspace",
          timeout_at: Date.now() + 60_000,
        },
      }),
    );

    const pending = await appMessages.next("danger.pending");
    expect(pending.payload.danger_id).toBe("danger-resolved-1");
    await waitFor(() => services.pendingDangers.getSize() === 1);

    appSocket.send(
      JSON.stringify({
        type: "danger.allow",
        payload: {
          session_id: "session-danger-resolved-1",
          danger_id: "danger-resolved-1",
          biometric_verified: true,
        },
      }),
    );

    const allow = await daemonMessages.next("danger.allow");
    expect(allow.payload.danger_id).toBe("danger-resolved-1");
    await waitFor(() => services.pendingDangers.getSize() === 0);

    await closeSocket(appSocket);

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    resumedSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );

    await resumedMessages.next("auth.token");
    await resumedMessages.next("device.status");

    let replayedDanger = false;
    try {
      await Promise.race([
        resumedMessages.next("danger.pending").then(() => {
          replayedDanger = true;
        }),
        new Promise((resolve) => setTimeout(resolve, 150)),
      ]);
    } catch {
      replayedDanger = false;
    }
    expect(replayedDanger).toBe(false);

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("forwards danger.result and clears pending replay cache", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-danger-result",
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

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-danger-result-pub",
      appEd25519PubKey: "app-danger-result-ed25519",
      appDeviceName: "Danger Result App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );
    await appMessages.next("auth.token");
    await appMessages.next("device.status");

    services.sessionRegistry.register(
      "session-danger-result-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      JSON.stringify({
        type: "danger.pending",
        payload: {
          danger_id: "danger-result-1",
          session_id: "session-danger-result-1",
          agent_id: null,
          agent_type: null,
          command: "sudo rm -rf /",
          tool_name: "bash",
          rule_matched: "dangerous bash",
          workspace: "/tmp/workspace",
          timeout_at: Date.now() + 60_000,
        },
      }),
    );

    await appMessages.next("danger.pending");
    await waitFor(() => services.pendingDangers.getSize() == 1);

    daemonSocket.send(
      JSON.stringify({
        type: "danger.result",
        payload: {
          danger_id: "danger-result-1",
          session_id: "session-danger-result-1",
          status: "timed_out",
          message: "Danger approval timed out",
        },
      }),
    );

    const result = await appMessages.next("danger.result");
    expect(result.payload).toEqual({
      danger_id: "danger-result-1",
      session_id: "session-danger-result-1",
      status: "timed_out",
      message: "Danger approval timed out",
    });
    await waitFor(() => services.pendingDangers.getSize() == 0);

    await closeSocket(appSocket);

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");
    resumedSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );

    await resumedMessages.next("auth.token");
    await resumedMessages.next("device.status");

    let replayedDanger = false;
    try {
      await Promise.race([
        resumedMessages.next("danger.pending").then(() => {
          replayedDanger = true;
        }),
        new Promise((resolve) => setTimeout(resolve, 150)),
      ]);
    } catch {
      replayedDanger = false;
    }
    expect(replayedDanger).toBe(false);

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("routes key ratchet control messages only to the session owner app", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-ratchet",
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

    const appA = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-a-pub",
      appEd25519PubKey: "app-a-ed25519",
      appDeviceName: "App A",
    });
    const appB = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-b-pub",
      appEd25519PubKey: "app-b-ed25519",
      appDeviceName: "App B",
    });
    const jwtA = await services.jwtManager.issue(appA.deviceId);
    const jwtB = await services.jwtManager.issue(appB.deviceId);

    const appSocketA = new WebSocket(relayUrl);
    const appMessagesA = createMessageReader(appSocketA);
    await waitForOpen(appSocketA);
    await appMessagesA.next("server.hello");
    appSocketA.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwtA.jwt,
        },
      }),
    );
    await appMessagesA.next("auth.token");

    const appSocketB = new WebSocket(relayUrl);
    const appMessagesB = createMessageReader(appSocketB);
    await waitForOpen(appSocketB);
    await appMessagesB.next("server.hello");
    appSocketB.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwtB.jwt,
        },
      }),
    );
    await appMessagesB.next("auth.token");

    services.sessionRegistry.register(
      "session-ratchet-1",
      appA.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      JSON.stringify({
        type: "key.ratchet",
        payload: {
          session_id: "session-ratchet-1",
          next_pubkey: "next-ratchet-pubkey",
        },
      }),
    );

    const ratchet = await appMessagesA.next("key.ratchet");
    expect(ratchet.payload.session_id).toBe("session-ratchet-1");
    expect(ratchet.payload.next_pubkey).toBe("next-ratchet-pubkey");

    let appBReceivedRatchet = false;
    try {
      await Promise.race([
        appMessagesB.next("key.ratchet").then(() => {
          appBReceivedRatchet = true;
        }),
        new Promise((resolve) => setTimeout(resolve, 150)),
      ]);
    } catch {
      appBReceivedRatchet = false;
    }
    expect(appBReceivedRatchet).toBe(false);

    await closeSocket(appSocketA);
    await closeSocket(appSocketB);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("routes session-scoped daemon utility messages only to the owning app", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-session-scope",
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

    const appA = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-a-pub-session",
      appEd25519PubKey: "app-a-ed25519-session",
      appDeviceName: "App A",
    });
    const appB = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-b-pub-session",
      appEd25519PubKey: "app-b-ed25519-session",
      appDeviceName: "App B",
    });
    const jwtA = await services.jwtManager.issue(appA.deviceId);
    const jwtB = await services.jwtManager.issue(appB.deviceId);

    const appSocketA = new WebSocket(relayUrl);
    const appMessagesA = createMessageReader(appSocketA);
    await waitForOpen(appSocketA);
    await appMessagesA.next("server.hello");
    appSocketA.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwtA.jwt,
        },
      }),
    );
    await appMessagesA.next("auth.token");

    const appSocketB = new WebSocket(relayUrl);
    const appMessagesB = createMessageReader(appSocketB);
    await waitForOpen(appSocketB);
    await appMessagesB.next("server.hello");
    appSocketB.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwtB.jwt,
        },
      }),
    );
    await appMessagesB.next("auth.token");

    services.sessionRegistry.register(
      "session-history-1",
      appA.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      JSON.stringify({
        type: "history.get",
        payload: {
          session_id: "session-history-1",
          offset: 0,
          total: 1,
          lines: ['{"type":"assistant","message":"hello"}'],
        },
      }),
    );

    const historyForA = await appMessagesA.next("history.get");
    expect(historyForA.payload.session_id).toBe("session-history-1");
    expect(historyForA.payload.lines).toEqual([
      '{"type":"assistant","message":"hello"}',
    ]);

    let appBReceivedHistory = false;
    try {
      await Promise.race([
        appMessagesB.next("history.get").then(() => {
          appBReceivedHistory = true;
        }),
        new Promise((resolve) => setTimeout(resolve, 150)),
      ]);
    } catch {
      appBReceivedHistory = false;
    }
    expect(appBReceivedHistory).toBe(false);

    await closeSocket(appSocketA);
    await closeSocket(appSocketB);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("bridges envelope-framed app traffic for pairing and replay resume", async () => {
    const { app, services } = await buildServer();
    const appIdentity = createAppIdentity();
    const daemonIdentity = createDaemonIdentity();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: daemonIdentity.publicKeyBase64Url,
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
      encodeEnvelope(
        {
          v: 1,
          id: "daemon-hello-1",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
        },
        {
          from: daemonDevice.device_id,
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-ready-1",
          type: "device.pair.ready",
          payload: {
            pairing_id: "pairing-envelope-1",
            pairing_code: "771244",
            expires_at: Date.now() + 30_000,
          },
        },
        {
          from: daemonDevice.device_id,
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    const pairStartRaw = encodeEnvelope(
      {
        v: 1,
        id: "pair-start-1",
        type: "device.pair",
        payload: {
          pairing_code: "771244",
          server_url: relayUrl,
          app_pubkey: "app-pub-key-envelope",
          app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
          app_device_name: "Envelope iPhone",
        },
      },
      {
        from: "app-instance-envelope-1",
        signingKey: appIdentity.privateKey,
      },
    );
    const pairStartEnvelope = JSON.parse(pairStartRaw) as { sig: string };
    appSocket.send(pairStartRaw);

    const forwardedPair = await nextEnvelopeMessage(
      daemonMessages,
      "device.pair",
    );
    expect(forwardedPair.message.payload.app_device_name).toBe(
      "Envelope iPhone",
    );
    expect(forwardedPair.envelope.sig).toBe(pairStartEnvelope.sig);

    const pairSasRaw = encodeEnvelope(
      {
        v: 1,
        id: "pair-sas-1",
        type: "device.pair.sas",
        payload: {
          sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
          noise_handshake: "noise-message-1",
          daemon_pubkey: "daemon-pub-key",
          daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
          machine_name: "Envelope-Mac",
          os: "darwin",
        },
      },
      {
        from: daemonDevice.device_id,
        signingKey: daemonIdentity.privateKey,
      },
    );
    const pairSasEnvelope = JSON.parse(pairSasRaw) as { sig: string };
    daemonSocket.send(pairSasRaw);

    const sas = await nextEnvelopeMessage(appMessages, "device.pair.sas");
    expect(sas.message.payload.machine_name).toBe("Envelope-Mac");
    expect(sas.message.payload.noise_handshake).toBe("noise-message-1");
    expect(sas.envelope.sig).toBe(pairSasEnvelope.sig);
    expect(sas.envelope.from).toBe(daemonDevice.device_id);

    const pairConfirmRaw = encodeEnvelope(
      {
        v: 1,
        id: "pair-confirm-1",
        type: "device.pair.confirm",
        payload: {
          confirmed: true,
          noise_handshake: "noise-message-2",
        },
      },
      {
        from: "app-instance-envelope-1",
        signingKey: appIdentity.privateKey,
      },
    );
    const pairConfirmEnvelope = JSON.parse(pairConfirmRaw) as { sig: string };
    appSocket.send(pairConfirmRaw);

    const forwardedConfirm = await nextEnvelopeMessage(
      daemonMessages,
      "device.pair.confirm",
    );
    expect(forwardedConfirm.envelope.sig).toBe(pairConfirmEnvelope.sig);
    expect(forwardedConfirm.message.payload.noise_handshake).toBe(
      "noise-message-2",
    );
    const authToken = await nextEnvelopeMessage(appMessages, "auth.token");
    const onlineStatus = await nextEnvelopeMessage(
      appMessages,
      "device.status",
    );
    const appDeviceId = parseJwtDeviceId(authToken.message.payload.jwt);
    expect(authToken.message.payload.jwt).toBeTypeOf("string");
    expect(onlineStatus.message.payload.machine_name).toBe("Envelope-Mac");

    const sessionStartRaw = encodeEnvelope(
      {
        v: 1,
        id: "session-start-1",
        type: "session.start",
        payload: {
          session_id: "session-envelope-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
      },
      {
        from: appDeviceId,
        sessionId: "session-envelope-1",
        signingKey: appIdentity.privateKey,
      },
    );
    const sessionStartEnvelope = JSON.parse(sessionStartRaw) as { sig: string };
    appSocket.send(sessionStartRaw);

    const forwardedStart = await nextEnvelopeMessage(
      daemonMessages,
      "session.start",
    );
    expect(forwardedStart.envelope.sig).toBe(sessionStartEnvelope.sig);

    const startResultRaw = encodeEnvelope(
      {
        v: 1,
        id: "session-start-result-1",
        type: "session.start.result",
        payload: {
          request_id: forwardedStart.message.id,
          session_id: "session-envelope-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          status: "started",
          message: "Session started",
        },
      },
      {
        from: daemonDevice.device_id,
        sessionId: "session-envelope-1",
        seq: 1,
        signingKey: daemonIdentity.privateKey,
      },
    );
    daemonSocket.send(startResultRaw);
    const startResult = await nextEnvelopeMessage(
      appMessages,
      "session.start.result",
    );
    expect(startResult.message.payload.status).toBe("started");

    const firstEventRaw = encodeEnvelope(
      {
        v: 1,
        id: "event-1",
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
      },
      {
        from: daemonDevice.device_id,
        sessionId: "session-envelope-1",
        seq: 2,
        signingKey: daemonIdentity.privateKey,
      },
    );
    const firstEventEnvelope = JSON.parse(firstEventRaw) as { sig: string };
    daemonSocket.send(firstEventRaw);

    const firstEvent = await nextEnvelopeMessage(appMessages, "session.event");
    expect(firstEvent.message.payload.seq).toBe(1);
    expect(firstEvent.envelope.seq).toBe(2);
    expect(firstEvent.envelope.sig).toBe(firstEventEnvelope.sig);
    expect(firstEvent.envelope.from).toBe(daemonDevice.device_id);

    await closeSocket(appSocket);

    const secondEventRaw = encodeEnvelope(
      {
        v: 1,
        id: "event-2",
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
      },
      {
        from: daemonDevice.device_id,
        sessionId: "session-envelope-1",
        seq: 2,
        signingKey: daemonIdentity.privateKey,
      },
    );
    const secondEventEnvelope = JSON.parse(secondEventRaw) as { sig: string };
    daemonSocket.send(secondEventRaw);

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    resumedSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-1",
          type: "auth.attach",
          payload: {
            jwt: authToken.message.payload.jwt,
          },
        },
        {
          from: appDeviceId,
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(resumedMessages, "auth.token");
    await nextEnvelopeMessage(resumedMessages, "device.status");

    resumedSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-replay-1",
          type: "session.replay",
          payload: {
            session_id: "session-envelope-1",
            from_seq: 1,
          },
        },
        {
          from: appDeviceId,
          sessionId: "session-envelope-1",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const replayedSecond = await nextEnvelopeMessage(
      resumedMessages,
      "session.event",
    );
    expect(replayedSecond.message.payload.seq).toBe(2);
    expect(replayedSecond.message.payload.event.text).toBe(
      "second envelope chunk",
    );
    expect(replayedSecond.envelope.sig).toBe(secondEventEnvelope.sig);
    expect(replayedSecond.envelope.from).toBe(daemonDevice.device_id);

    const replayDone = await nextEnvelopeMessage(
      resumedMessages,
      "replay.done",
    );
    expect(replayDone.message.payload.session_id).toBe("session-envelope-1");
    expect(replayDone.message.payload.replayed_count).toBe(1);
    expect(replayDone.message.payload.current_seq).toBe(2);
    expect(replayDone.message.payload.status).toBe("ok");
    expect(replayDone.message.payload.message).toBe("Replay complete");
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
    expect(replay.entries.map((entry) => entry.message.payload.seq)).toEqual([
      2, 3, 4,
    ]);
    expect(replay.replayedCount).toBe(3);
    expect(replay.currentSeq).toBe(4);
    expect(buffer.getSessionSize("session-capacity-1")).toBe(3);
  });

  it("returns structured replay.done when session.resume targets a missing session", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-replay-missing",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-replay-missing-pub",
      appEd25519PubKey: "app-replay-missing-ed25519",
      appDeviceName: "Replay Missing App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      JSON.stringify({
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      }),
    );
    await appMessages.next("auth.token");

    appSocket.send(
      JSON.stringify({
        type: "session.resume",
        payload: {
          session_id: "missing-session",
          last_seq: 9,
        },
      }),
    );

    const replayDone = await appMessages.next("replay.done");
    expect(replayDone.payload).toEqual({
      session_id: "missing-session",
      replayed_count: 0,
      current_seq: 9,
      status: "session_not_found",
      message: "Session not found for replay",
    });

    await closeSocket(appSocket);
    await app.close();
  });

  it("rejects session.resume from an unauthenticated socket", async () => {
    const { app } = await buildServer();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const socket = new WebSocket(relayUrl);
    const messages = createMessageReader(socket);
    await waitForOpen(socket);
    await messages.next("server.hello");

    socket.send(
      JSON.stringify({
        type: "session.resume",
        payload: {
          session_id: "sess-unauth",
          last_seq: 3,
        },
      }),
    );

    const error = await messages.next("error");
    expect(error.payload.code).toBe("AUTH_INVALID");
    expect(error.payload.message).toBe("App is not authenticated");

    await closeSocket(socket);
    await app.close();
  });
});
