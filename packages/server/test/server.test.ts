import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TransportControlSessionId,
  createEnvelopeSigningPayload,
} from "@hellobug/protocol";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { buildServer } from "../src/app.js";
import { ServerStateStore } from "../src/lib/state-store.js";
import type { PushProvider } from "../src/push/provider.js";
import { RelayReplayBuffer } from "../src/relay/buffer.js";

const envelopeSequenceCounters = new WeakMap<KeyObject, number>();
const defaultOpaquePlaceholderTypes = new Set([
  "auth.attach",
  "auth.refresh",
  "daemon.hello",
  "device.pair.ready",
  "device.pair",
  "device.pair.sas",
  "device.pair.confirm",
  "device.push_token",
  "device.list",
  "device.rename",
  "device.revoke",
  "session.resume",
  "session.start",
  "session.agent.add",
  "session.input",
  "session.input.image",
  "session.input.voice_text",
  "session.command.slash",
  "session.cancel",
  "fs.tree.req",
  "fs.file.req",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "pty.input",
  "pty.resize",
]);
const transportControlPlaceholderTypes = new Set([
  "auth.attach",
  "auth.refresh",
  "daemon.hello",
  "device.push_token",
  "device.list",
  "device.rename",
  "device.revoke",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "templates.list",
]);
const encryptedRoutingHintTypes = new Set([
  "session.start",
  "session.start.result",
  "session.event",
  "danger.pending",
  "danger.result",
  "push.trigger",
  "danger.allow",
  "danger.deny",
]);

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
    ts?: number;
    requestId?: string;
    routingPayload?: Record<string, unknown>;
    omitRoutingPayload?: boolean;
    messageType?: string;
    cipherMode?: "plain" | "noise_static_v1";
    senderPubkey?: string;
    ciphertext?: string;
    signingKey?: KeyObject;
    legacyOmitOuterMetadata?: boolean;
    legacySigningPayload?: boolean;
  } = {},
): string {
  const seq =
    options.seq ??
    (options.signingKey ? nextEnvelopeSequence(options.signingKey) : 1);
  const inferredMessageType =
    typeof message.type === "string" ? message.type : undefined;
  const shouldUseDefaultOpaquePlaceholder =
    !options.legacyOmitOuterMetadata &&
    inferredMessageType !== undefined &&
    defaultOpaquePlaceholderTypes.has(inferredMessageType) &&
    options.cipherMode === undefined &&
    options.ciphertext === undefined &&
    options.routingPayload === undefined;
  const payloadSessionId =
    message.payload &&
    typeof message.payload === "object" &&
    !Array.isArray(message.payload) &&
    typeof (message.payload as { session_id?: unknown }).session_id === "string"
      ? ((message.payload as { session_id: string }).session_id ?? "")
      : "";
  const sessionId =
    options.sessionId ??
    (payloadSessionId.length > 0
      ? payloadSessionId
      : shouldUseDefaultOpaquePlaceholder &&
          inferredMessageType !== undefined &&
          transportControlPlaceholderTypes.has(inferredMessageType)
        ? TransportControlSessionId
        : "");
  const requestId =
    options.requestId ??
    (typeof message.id === "string" ? message.id : undefined);
  const routingPayload =
    options.omitRoutingPayload
      ? undefined
      : options.routingPayload ??
    (shouldUseDefaultOpaquePlaceholder &&
    message.payload &&
    typeof message.payload === "object" &&
    !Array.isArray(message.payload)
      ? (message.payload as Record<string, unknown>)
      : options.cipherMode === "noise_static_v1" &&
            inferredMessageType !== undefined &&
            encryptedRoutingHintTypes.has(inferredMessageType) &&
            message.payload &&
            typeof message.payload === "object" &&
            !Array.isArray(message.payload)
        ? (message.payload as Record<string, unknown>)
      : undefined);
  const ciphertext =
    options.ciphertext ??
    (shouldUseDefaultOpaquePlaceholder
      ? Buffer.from("opaque", "utf8").toString("base64url")
      : Buffer.from(JSON.stringify(message), "utf8").toString("base64url"));
  const envelope = {
    from: options.from ?? "app-device",
    to: options.to ?? "",
    session_id: sessionId,
    seq,
    ts: options.ts ?? Date.now(),
    sig: "",
    ciphertext,
    ...(!options.legacyOmitOuterMetadata &&
    (options.messageType ?? inferredMessageType)
      ? {
          message_type: options.messageType ?? inferredMessageType,
        }
      : {}),
    ...(!options.legacyOmitOuterMetadata
      ? {
          cipher_mode:
            options.cipherMode ??
            (shouldUseDefaultOpaquePlaceholder ? "noise_static_v1" : "plain"),
        }
      : {}),
    ...(options.senderPubkey ? { sender_pubkey: options.senderPubkey } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(routingPayload
      ? {
          routing_payload: Buffer.from(
            JSON.stringify(routingPayload),
            "utf8",
          ).toString("base64url"),
        }
      : {}),
  };
  if (options.signingKey) {
    envelope.sig = sign(
      null,
      new TextEncoder().encode(
        JSON.stringify([
          envelope.from,
          envelope.to,
          envelope.session_id,
          envelope.seq,
          envelope.ts,
          envelope.ciphertext,
          envelope.message_type ?? "",
          envelope.cipher_mode ?? "",
          envelope.sender_pubkey ?? "",
          envelope.request_id ?? "",
          ...(options.legacySigningPayload
            ? []
            : [envelope.routing_payload ?? ""]),
        ]),
      ),
      options.signingKey,
    ).toString("base64url");
  }
  return JSON.stringify(envelope);
}

function nextEnvelopeSequence(signingKey: KeyObject): number {
  const next = (envelopeSequenceCounters.get(signingKey) ?? 0) + 1;
  envelopeSequenceCounters.set(signingKey, next);
  return next;
}

function decodeEnvelope(raw: any): { envelope: any; message: any } {
  if (
    raw &&
    typeof raw === "object" &&
    raw.cipher_mode === "noise_static_v1" &&
    typeof raw.message_type === "string" &&
    typeof raw.routing_payload === "string"
  ) {
    return {
      envelope: raw,
      message: {
        v: 1,
        ...(typeof raw.request_id === "string" && raw.request_id.length > 0
          ? { id: raw.request_id }
          : {}),
        type: raw.message_type,
        payload: JSON.parse(
          Buffer.from(raw.routing_payload, "base64url").toString("utf8"),
        ),
      },
    };
  }

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

async function nextRawEnvelope(
  reader: ReturnType<typeof createMessageReader>,
  predicate: (envelope: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  while (true) {
    const raw = await reader.next();
    if (!raw || typeof raw !== "object" || !("ciphertext" in raw)) {
      continue;
    }

    const envelope = raw as Record<string, unknown>;
    if (predicate(envelope)) {
      return envelope;
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

function sendSignedMessage(
  socket: WebSocket,
  message: Record<string, unknown>,
  options: {
    from: string;
    signingKey: KeyObject;
    to?: string;
    sessionId?: string;
    seq?: number;
    ts?: number;
    requestId?: string;
    routingPayload?: Record<string, unknown>;
    messageType?: string;
    cipherMode?: "plain" | "noise_static_v1";
    senderPubkey?: string;
    ciphertext?: string;
  },
): void {
  socket.send(encodeEnvelope(message, options));
}

function sendDaemonHello(
  socket: WebSocket,
  daemonIdentity: ReturnType<typeof createDaemonIdentity>,
  options: {
    deviceId: string;
    daemonVersion?: string;
    supportedFeatures?: string[];
  },
): void {
  const daemonVersion = options.daemonVersion ?? "0.1.0";
  const supportedFeatures = options.supportedFeatures ?? [
    "e2ee_noise_ik",
    "multi_session",
  ];

  sendSignedMessage(
    socket,
    {
      v: 1,
      id: `daemon-hello-${options.deviceId}`,
      type: "daemon.hello",
      payload: {
        device_id: options.deviceId,
        daemon_version: daemonVersion,
        supported_features: supportedFeatures,
      },
    },
    {
      from: options.deviceId,
      signingKey: daemonIdentity.privateKey,
    },
  );
}

function sendAuthAttach(
  socket: WebSocket,
  appIdentity: ReturnType<typeof createAppIdentity>,
  options: {
    deviceId: string;
    jwt: string;
    id?: string;
  },
): void {
  sendSignedMessage(
    socket,
    {
      v: 1,
      id: options.id ?? `auth-attach-${options.deviceId}`,
      type: "auth.attach",
      payload: {
        jwt: options.jwt,
      },
    },
    {
      from: options.deviceId,
      signingKey: appIdentity.privateKey,
    },
  );
}

function createMockPushProvider(
  send: PushProvider["send"],
): PushProvider {
  return { send };
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
    const daemonIdentity = createDaemonIdentity();

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
        device_pub_key: daemonIdentity.publicKeyBase64Url,
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
    const daemonClosed = new Promise<void>((resolve) => {
      daemonSocket.once("close", () => resolve());
    });
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");

    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
      daemonVersion: "0.3.1",
      supportedFeatures: ["e2ee_noise_ik", "multi_session", "workspace_discovery"],
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(daemonSocket.readyState).toBe(WebSocket.OPEN);
    expect(
      second.services.deviceRegistry.getDaemonDevice(daemonDevice.device_id),
    ).toMatchObject({
      daemonVersion: "0.3.1",
      supportedFeatures: [
        "e2ee_noise_ik",
        "multi_session",
        "workspace_discovery",
      ],
    });

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

    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-1",
    });

    await nextEnvelopeMessage(appMessages, "auth.token");

    sendSignedMessage(
      appSocket,
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
        sessionId: TransportControlSessionId,
        requestId: "push-token-1",
        messageType: "device.push_token",
        cipherMode: "noise_static_v1",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        routingPayload: {
          platform: "ios",
          apns_token: "abcd1234",
          manufacturer: null,
          vendor_token: null,
        },
        signingKey: appIdentity.privateKey,
      },
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

  it("dispatches push notifications only to linked offline app devices", async () => {
    const { app, services } = await buildServer({
      jwtSecret: "push-dispatch-secret",
    });
    const daemonIdentity = createDaemonIdentity();
    const onlineAppIdentity = createAppIdentity();
    const offlineAppIdentity = createAppIdentity();
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
    const onlineApp = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "online-app-pub",
      appEd25519PubKey: onlineAppIdentity.publicKeyBase64Url,
      appDeviceName: "Online iPhone",
    });
    const offlineApp = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "offline-app-pub",
      appEd25519PubKey: offlineAppIdentity.publicKeyBase64Url,
      appDeviceName: "Offline iPhone",
    });
    services.deviceRegistry.updateAppPushToken(onlineApp.deviceId, {
      platform: "ios",
      apnsToken: "online-apns-token",
    });
    services.deviceRegistry.updateAppPushToken(offlineApp.deviceId, {
      platform: "ios",
      apnsToken: "offline-apns-token",
    });
    services.sessionRegistry.register(
      "push-session-1",
      onlineApp.deviceId,
      daemonDevice.device_id,
      true,
    );
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const onlineAppSocket = new WebSocket(relayUrl);
    const onlineAppMessages = createMessageReader(onlineAppSocket);
    await waitForOpen(onlineAppSocket);
    await onlineAppMessages.next("server.hello");
    const onlineJwt = await services.jwtManager.issue(onlineApp.deviceId);
    sendAuthAttach(onlineAppSocket, onlineAppIdentity, {
      deviceId: onlineApp.deviceId,
      jwt: onlineJwt.jwt,
      id: "auth-attach-online-push-1",
    });
    await nextEnvelopeMessage(onlineAppMessages, "auth.token");
    await nextEnvelopeMessage(onlineAppMessages, "device.status");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "push.trigger",
          payload: {
            session_id: "push-session-1",
            event_type: "danger_pending",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "push-session-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-push-pubkey-1",
          routingPayload: {
            session_id: "push-session-1",
            event_type: "danger_pending",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await waitFor(() => services.push.listDispatches().length === 1);
    expect(services.push.listDispatches()).toEqual([
      expect.objectContaining({
        appDeviceId: offlineApp.deviceId,
        daemonDeviceId: daemonDevice.device_id,
        payload: expect.objectContaining({
          session_id: "push-session-1",
          event_type: "danger_pending",
        }),
      }),
    ]);

    await closeSocket(onlineAppSocket);
    await waitFor(
      () => services.relayRegistry.getAppSockets(onlineApp.deviceId).length === 0,
    );

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "push.trigger",
          payload: {
            session_id: "push-session-1",
            event_type: "task_done",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "push-session-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-push-pubkey-1",
          routingPayload: {
            session_id: "push-session-1",
            event_type: "task_done",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await waitFor(() => services.push.listDispatches().length === 3);
    expect(services.push.listDispatches()).toEqual([
      expect.objectContaining({
        appDeviceId: offlineApp.deviceId,
        daemonDeviceId: daemonDevice.device_id,
        payload: expect.objectContaining({
          session_id: "push-session-1",
          event_type: "danger_pending",
        }),
      }),
      expect.objectContaining({
        appDeviceId: onlineApp.deviceId,
        daemonDeviceId: daemonDevice.device_id,
        payload: expect.objectContaining({
          session_id: "push-session-1",
          event_type: "task_done",
        }),
      }),
      expect.objectContaining({
        appDeviceId: offlineApp.deviceId,
        daemonDeviceId: daemonDevice.device_id,
        payload: expect.objectContaining({
          session_id: "push-session-1",
          event_type: "task_done",
        }),
      }),
    ]);

    await closeSocket(daemonSocket);
    await app.close();
  });

  it("clears invalid push tokens when provider rejects them", async () => {
    const pushProvider = createMockPushProvider(async (target) => ({
      status: "invalid_token",
      provider: target.route.platform === "ios" ? "mock-apns" : "mock-android",
      reason: "token expired",
    }));
    const { app, services } = await buildServer({
      jwtSecret: "push-invalid-token-secret",
      pushProvider,
    });
    const daemonIdentity = createDaemonIdentity();
    const offlineAppIdentity = createAppIdentity();
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
    const offlineApp = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "offline-app-pub",
      appEd25519PubKey: offlineAppIdentity.publicKeyBase64Url,
      appDeviceName: "Offline iPhone",
    });
    services.deviceRegistry.updateAppPushToken(offlineApp.deviceId, {
      platform: "ios",
      apnsToken: "stale-apns-token",
    });
    services.sessionRegistry.register(
      "push-session-invalid-token",
      offlineApp.deviceId,
      daemonDevice.device_id,
      true,
    );
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "push.trigger",
          payload: {
            session_id: "push-session-invalid-token",
            event_type: "session_error",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "push-session-invalid-token",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-push-pubkey-invalid-1",
          routingPayload: {
            session_id: "push-session-invalid-token",
            event_type: "session_error",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await waitFor(() => services.push.listDispatches().length === 1);
    expect(services.push.listDispatches()).toEqual([
      expect.objectContaining({
        appDeviceId: offlineApp.deviceId,
        daemonDeviceId: daemonDevice.device_id,
        route: {
          platform: "ios",
          apnsToken: "stale-apns-token",
        },
        result: {
          status: "invalid_token",
          provider: "mock-apns",
          reason: "token expired",
        },
      }),
    ]);
    const invalidatedApp = services.deviceRegistry.getAppDevice(offlineApp.deviceId);
    expect(invalidatedApp).toMatchObject({
      deviceId: offlineApp.deviceId,
      pushTokenInvalidatedAt: expect.any(Number),
    });
    expect(invalidatedApp?.pushPlatform).toBeUndefined();
    expect(invalidatedApp?.apnsToken).toBeUndefined();

    await closeSocket(daemonSocket);
    await app.close();
  });

  it("skips android manufacturer Other when selecting push routes", async () => {
    const sentTargets: Array<{ appDeviceId: string; platform: string }> = [];
    const pushProvider = createMockPushProvider(async (target) => {
      sentTargets.push({
        appDeviceId: target.appDeviceId,
        platform: target.route.platform,
      });
      return {
        status: "accepted",
        provider: target.route.platform === "ios" ? "mock-apns" : "mock-android",
      };
    });
    const { app, services } = await buildServer({
      jwtSecret: "push-android-other-secret",
      pushProvider,
    });
    const daemonIdentity = createDaemonIdentity();
    const iosAppIdentity = createAppIdentity();
    const androidOtherIdentity = createAppIdentity();
    const androidVendorIdentity = createAppIdentity();
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
    const iosApp = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "ios-app-pub",
      appEd25519PubKey: iosAppIdentity.publicKeyBase64Url,
      appDeviceName: "Offline iPhone",
    });
    const androidOtherApp = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "android-other-app-pub",
      appEd25519PubKey: androidOtherIdentity.publicKeyBase64Url,
      appDeviceName: "Android Other",
    });
    const androidVendorApp = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "android-vendor-app-pub",
      appEd25519PubKey: androidVendorIdentity.publicKeyBase64Url,
      appDeviceName: "Android Xiaomi",
    });

    services.deviceRegistry.updateAppPushToken(iosApp.deviceId, {
      platform: "ios",
      apnsToken: "ios-token-1",
    });
    services.deviceRegistry.updateAppPushToken(androidOtherApp.deviceId, {
      platform: "android",
      manufacturer: "Other",
      vendorToken: "fcm-or-other-token",
    });
    services.deviceRegistry.updateAppPushToken(androidVendorApp.deviceId, {
      platform: "android",
      manufacturer: "Xiaomi",
      vendorToken: "xiaomi-token-1",
    });
    services.sessionRegistry.register(
      "push-session-android-routes",
      iosApp.deviceId,
      daemonDevice.device_id,
      true,
    );
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "push.trigger",
          payload: {
            session_id: "push-session-android-routes",
            event_type: "task_done",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "push-session-android-routes",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-push-pubkey-android-1",
          routingPayload: {
            session_id: "push-session-android-routes",
            event_type: "task_done",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await waitFor(() => services.push.listDispatches().length === 2);
    expect(sentTargets).toEqual([
      {
        appDeviceId: iosApp.deviceId,
        platform: "ios",
      },
      {
        appDeviceId: androidVendorApp.deviceId,
        platform: "android",
      },
    ]);
    expect(
      services.push
        .listDispatches()
        .map((record) => record.appDeviceId)
        .sort(),
    ).toEqual([androidVendorApp.deviceId, iosApp.deviceId].sort());

    await closeSocket(daemonSocket);
    await app.close();
  });

  it("lists, renames, and revokes linked daemon devices for authenticated apps", async () => {
    const { app, services } = await buildServer({
      jwtSecret: "device-management-secret",
    });
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const daemonClosed = new Promise<void>((resolve) => {
      daemonSocket.once("close", () => resolve());
    });
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "daemon-hello-mgmt",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.2.0",
            supported_features: ["pty", "workspace_discovery"],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          messageType: "daemon.hello",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.2.0",
            supported_features: ["pty", "workspace_discovery"],
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    services.deviceRegistry.updateDaemonMetadata(daemonDevice.device_id, {
      machineName: "Build Mac",
      os: "darwin",
    });
    services.presence.rename(daemonDevice.device_id, "Build Mac");

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-device-mgmt-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Device Management iPhone",
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
          id: "auth-attach-mgmt",
          type: "auth.attach",
          payload: {
            jwt: jwt.jwt,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "auth-attach-mgmt",
          messageType: "auth.attach",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            jwt: jwt.jwt,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const authToken = await nextEnvelopeMessage(appMessages, "auth.token");
    expect(authToken.envelope.cipher_mode).toBe("noise_static_v1");
    expect(authToken.envelope.message_type).toBe("auth.token");
    expect(authToken.envelope.session_id).toBe(TransportControlSessionId);
    expect(typeof authToken.envelope.routing_payload).toBe("string");
    const initialPresence = await nextEnvelopeMessage(
      appMessages,
      "device.status",
    );
    const initialLastSeenAt = initialPresence.message.payload.last_seen_at;
    expect(initialPresence.message.payload).toEqual({
      device_id: daemonDevice.device_id,
      online: true,
      machine_name: "Build Mac",
      ts: expect.any(Number),
      os: "darwin",
      daemon_version: "0.2.0",
      paired_at: expect.any(Number),
      last_seen_at: expect.any(Number),
      revoked_at: null,
      active_session_count: 0,
    });

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "device-list-1",
          type: "device.list",
          payload: {},
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "device-list-1",
          messageType: "device.list",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {},
          signingKey: appIdentity.privateKey,
        },
      ),
    );
    const list = await nextEnvelopeMessage(appMessages, "device.list");
    expect(list.envelope.cipher_mode).toBe("noise_static_v1");
    expect(list.envelope.session_id).toBe(TransportControlSessionId);
    expect(list.message.payload.devices).toEqual([
      {
        device_id: daemonDevice.device_id,
        machine_name: "Build Mac",
        os: "darwin",
        daemon_version: "0.2.0",
        online: true,
        paired_at: expect.any(Number),
        last_seen_at: expect.any(Number),
        revoked_at: null,
        active_session_count: 0,
      },
    ]);

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "device-rename-1",
          type: "device.rename",
          payload: {
            device_id: daemonDevice.device_id,
            machine_name: "Office Mac",
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "device-rename-1",
          messageType: "device.rename",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            device_id: daemonDevice.device_id,
            machine_name: "Office Mac",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );
    const renamedPresence = await nextEnvelopeMessage(
      appMessages,
      "device.status",
    );
    const renamed = await nextEnvelopeMessage(appMessages, "device.rename");
    expect(renamed.envelope.cipher_mode).toBe("noise_static_v1");
    expect(renamed.envelope.session_id).toBe(TransportControlSessionId);
    expect(renamedPresence.message.payload).toEqual({
      device_id: daemonDevice.device_id,
      online: true,
      machine_name: "Office Mac",
      ts: expect.any(Number),
      os: "darwin",
      daemon_version: "0.2.0",
      paired_at: expect.any(Number),
      last_seen_at: expect.any(Number),
      revoked_at: null,
      active_session_count: 0,
    });
    expect(renamedPresence.message.payload.last_seen_at).toBe(initialLastSeenAt);
    expect(renamedPresence.message.payload.ts).toBeGreaterThanOrEqual(
      initialPresence.message.payload.ts,
    );
    expect(renamed.message.payload.device.machine_name).toBe("Office Mac");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "device-revoke-1",
          type: "device.revoke",
          payload: {
            device_id: daemonDevice.device_id,
            mode: "revoke",
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "device-revoke-1",
          messageType: "device.revoke",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            device_id: daemonDevice.device_id,
            mode: "revoke",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );
    const revoked = await nextEnvelopeMessage(appMessages, "device.revoke");
    expect(revoked.envelope.cipher_mode).toBe("noise_static_v1");
    expect(revoked.envelope.session_id).toBe(TransportControlSessionId);
    const offline = await nextEnvelopeMessage(appMessages, "device.status");
    expect(revoked.message.payload.disconnected).toBe(true);
    expect(revoked.message.payload.mode).toBe("revoke");
    expect(offline.message.payload).toEqual({
      device_id: daemonDevice.device_id,
      online: false,
      machine_name: "Office Mac",
      ts: expect.any(Number),
      os: "darwin",
      daemon_version: "0.2.0",
      paired_at: expect.any(Number),
      last_seen_at: expect.any(Number),
      revoked_at: expect.any(Number),
      active_session_count: 0,
    });
    await daemonClosed;
    expect(
      services.deviceRegistry.getDaemonDevice(daemonDevice.device_id)
        ?.revokedAt,
    ).toBeTypeOf("number");

    await closeSocket(appSocket);
    await app.close();
  });

  it("routes workspace discovery responses only back to the requesting app", async () => {
    const { app, services } = await buildServer({
      jwtSecret: "workspace-routing-secret",
    });
    const daemonIdentity = createDaemonIdentity();
    const appOneIdentity = createAppIdentity();
    const appTwoIdentity = createAppIdentity();
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
    const daemonClosed = new Promise<void>((resolve) => {
      daemonSocket.once("close", () => resolve());
    });
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "daemon-hello-workspace",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.2.0",
            supported_features: ["workspace_discovery"],
          },
        },
        {
          from: daemonDevice.device_id,
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    const appOne = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-one-pub",
      appEd25519PubKey: appOneIdentity.publicKeyBase64Url,
      appDeviceName: "App One",
    });
    const appTwo = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-two-pub",
      appEd25519PubKey: appTwoIdentity.publicKeyBase64Url,
      appDeviceName: "App Two",
    });
    const appOneJwt = await services.jwtManager.issue(appOne.deviceId);
    const appTwoJwt = await services.jwtManager.issue(appTwo.deviceId);
    await services.persistState();

    const appOneSocket = new WebSocket(relayUrl);
    const appOneMessages = createMessageReader(appOneSocket);
    await waitForOpen(appOneSocket);
    await appOneMessages.next("server.hello");
    appOneSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-app-one",
          type: "auth.attach",
          payload: {
            jwt: appOneJwt.jwt,
          },
        },
        {
          from: appOne.deviceId,
          signingKey: appOneIdentity.privateKey,
        },
      ),
    );
    await nextEnvelopeMessage(appOneMessages, "auth.token");

    const appTwoSocket = new WebSocket(relayUrl);
    const appTwoMessages = createMessageReader(appTwoSocket);
    await waitForOpen(appTwoSocket);
    await appTwoMessages.next("server.hello");
    appTwoSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-app-two",
          type: "auth.attach",
          payload: {
            jwt: appTwoJwt.jwt,
          },
        },
        {
          from: appTwo.deviceId,
          signingKey: appTwoIdentity.privateKey,
        },
      ),
    );
    await nextEnvelopeMessage(appTwoMessages, "auth.token");

    appOneSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "workspace-list-1",
          type: "workspace.list",
          payload: {},
        },
        {
          from: appOne.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "workspace-list-1",
          messageType: "workspace.list",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-one-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXdvcmtzcGFjZS1saXN0LXJlcQ",
          signingKey: appOneIdentity.privateKey,
        },
      ),
    );
    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "workspace.list" &&
        envelope.request_id === "workspace-list-1",
    );
    expect(forwarded.request_id).toBe("workspace-list-1");
    expect(forwarded.cipher_mode).toBe("noise_static_v1");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "workspace-list-1",
          type: "workspace.list",
          payload: {
            default_path: "/tmp/workspace-a",
            items: [
              {
                path: "/tmp/workspace-a",
                name: "workspace-a",
                status: "ready",
                is_default: true,
                entry_count: 3,
                is_empty: false,
                repo_root: "/tmp/workspace-a",
                git_branch: "main",
              },
            ],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "workspace-list-1",
          messageType: "workspace.list",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-workspace-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXdvcmtzcGFjZS1saXN0LXJlc3A",
          routingPayload: {
            default_path: "/tmp/workspace-a",
            items: [
              {
                path: "/tmp/workspace-a",
                name: "workspace-a",
                status: "ready",
                is_default: true,
                entry_count: 3,
                is_empty: false,
                repo_root: "/tmp/workspace-a",
                git_branch: "main",
              },
            ],
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const routed = await nextEnvelopeMessage(appOneMessages, "workspace.list");
    expect(routed.message.payload.default_path).toBe("/tmp/workspace-a");
    expect(routed.message.payload.items[0]).toMatchObject({
      is_empty: false,
      repo_root: "/tmp/workspace-a",
      git_branch: "main",
    });
    await expect(
      Promise.race([
        nextEnvelopeMessage(appTwoMessages, "workspace.list"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appOneSocket);
    await closeSocket(appTwoSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("broadcasts offline rename status to every linked app without changing last_seen_at", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appOneIdentity = createAppIdentity();
    const appTwoIdentity = createAppIdentity();
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
    const daemonClosed = new Promise<void>((resolve) => {
      daemonSocket.once("close", () => resolve());
    });
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "daemon-hello-offline-rename",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.2.0",
            supported_features: ["workspace_discovery"],
          },
        },
        {
          from: daemonDevice.device_id,
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    services.deviceRegistry.updateDaemonMetadata(daemonDevice.device_id, {
      machineName: "Studio Mac",
      os: "darwin",
    });
    services.presence.rename(daemonDevice.device_id, "Studio Mac");

    const appOne = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "offline-rename-app-one-pub",
      appEd25519PubKey: appOneIdentity.publicKeyBase64Url,
      appDeviceName: "Offline Rename App One",
    });
    const appTwo = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "offline-rename-app-two-pub",
      appEd25519PubKey: appTwoIdentity.publicKeyBase64Url,
      appDeviceName: "Offline Rename App Two",
    });
    const appOneJwt = await services.jwtManager.issue(appOne.deviceId);
    const appTwoJwt = await services.jwtManager.issue(appTwo.deviceId);
    await services.persistState();

    const appOneSocket = new WebSocket(relayUrl);
    const appOneMessages = createMessageReader(appOneSocket);
    await waitForOpen(appOneSocket);
    await appOneMessages.next("server.hello");
    appOneSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-offline-rename-app-one",
          type: "auth.attach",
          payload: {
            jwt: appOneJwt.jwt,
          },
        },
        {
          from: appOne.deviceId,
          signingKey: appOneIdentity.privateKey,
        },
      ),
    );
    await nextEnvelopeMessage(appOneMessages, "auth.token");
    const initialStatusOne = await nextEnvelopeMessage(
      appOneMessages,
      "device.status",
    );

    const appTwoSocket = new WebSocket(relayUrl);
    const appTwoMessages = createMessageReader(appTwoSocket);
    await waitForOpen(appTwoSocket);
    await appTwoMessages.next("server.hello");
    appTwoSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-offline-rename-app-two",
          type: "auth.attach",
          payload: {
            jwt: appTwoJwt.jwt,
          },
        },
        {
          from: appTwo.deviceId,
          signingKey: appTwoIdentity.privateKey,
        },
      ),
    );
    await nextEnvelopeMessage(appTwoMessages, "auth.token");
    const initialStatusTwo = await nextEnvelopeMessage(
      appTwoMessages,
      "device.status",
    );

    daemonSocket.close();
    const offlineStatusOne = await nextEnvelopeMessage(
      appOneMessages,
      "device.status",
    );
    const offlineStatusTwo = await nextEnvelopeMessage(
      appTwoMessages,
      "device.status",
    );
    expect(offlineStatusOne.message.payload.online).toBe(false);
    expect(offlineStatusTwo.message.payload.online).toBe(false);
    expect(offlineStatusOne.message.payload.last_seen_at).toBeTypeOf("number");
    expect(offlineStatusTwo.message.payload.last_seen_at).toBeTypeOf("number");
    expect(offlineStatusOne.message.payload.last_seen_at).toBe(
      offlineStatusTwo.message.payload.last_seen_at,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    appOneSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "device-rename-offline-1",
          type: "device.rename",
          payload: {
            device_id: daemonDevice.device_id,
            machine_name: "Office Mac",
          },
        },
        {
          from: appOne.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "device-rename-offline-1",
          messageType: "device.rename",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            device_id: daemonDevice.device_id,
            machine_name: "Office Mac",
          },
          signingKey: appOneIdentity.privateKey,
        },
      ),
    );

    const renamedStatusOne = await nextEnvelopeMessage(
      appOneMessages,
      "device.status",
    );
    const renamedAckOne = await nextEnvelopeMessage(
      appOneMessages,
      "device.rename",
    );
    const renamedStatusTwo = await nextEnvelopeMessage(
      appTwoMessages,
      "device.status",
    );

    expect(initialStatusOne.message.payload.machine_name).toBe("Studio Mac");
    expect(initialStatusTwo.message.payload.machine_name).toBe("Studio Mac");
    expect(renamedAckOne.message.payload.device.machine_name).toBe("Office Mac");
    expect(renamedStatusOne.message.payload).toEqual({
      device_id: daemonDevice.device_id,
      online: false,
      machine_name: "Office Mac",
      ts: expect.any(Number),
      os: "darwin",
      daemon_version: "0.2.0",
      paired_at: expect.any(Number),
      last_seen_at: offlineStatusOne.message.payload.last_seen_at,
      revoked_at: null,
      active_session_count: 0,
    });
    expect(renamedStatusTwo.message.payload).toEqual({
      device_id: daemonDevice.device_id,
      online: false,
      machine_name: "Office Mac",
      ts: expect.any(Number),
      os: "darwin",
      daemon_version: "0.2.0",
      paired_at: expect.any(Number),
      last_seen_at: offlineStatusTwo.message.payload.last_seen_at,
      revoked_at: null,
      active_session_count: 0,
    });
    expect(renamedStatusOne.message.payload.ts).toBeGreaterThan(
      offlineStatusOne.message.payload.ts,
    );
    expect(renamedStatusTwo.message.payload.ts).toBeGreaterThan(
      offlineStatusTwo.message.payload.ts,
    );

    await closeSocket(appOneSocket);
    await closeSocket(appTwoSocket);
    await daemonClosed;
    await app.close();
  });

  it("routes encrypted control responses only back to the requesting app", async () => {
    const { app, services } = await buildServer();
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
    const appOneIdentity = createAppIdentity();
    const appOne = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "workspace-enc-app-one-pub",
      appEd25519PubKey: appOneIdentity.publicKeyBase64Url,
      appDeviceName: "Workspace Enc App One",
    });
    const appTwoIdentity = createAppIdentity();
    const appTwo = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "workspace-enc-app-two-pub",
      appEd25519PubKey: appTwoIdentity.publicKeyBase64Url,
      appDeviceName: "Workspace Enc App Two",
    });
    const appOneJwt = await services.jwtManager.issue(appOne.deviceId);
    const appTwoJwt = await services.jwtManager.issue(appTwo.deviceId);
    await services.persistState();

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
          id: "daemon-hello-enc",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session", "pty"],
          },
        },
        {
          from: daemonDevice.device_id,
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    const appOneSocket = new WebSocket(relayUrl);
    const appOneMessages = createMessageReader(appOneSocket);
    await waitForOpen(appOneSocket);
    await appOneMessages.next("server.hello");
    appOneSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-app-one-enc",
          type: "auth.attach",
          payload: {
            jwt: appOneJwt.jwt,
          },
        },
        {
          from: appOne.deviceId,
          signingKey: appOneIdentity.privateKey,
        },
      ),
    );
    await nextEnvelopeMessage(appOneMessages, "auth.token");

    const appTwoSocket = new WebSocket(relayUrl);
    const appTwoMessages = createMessageReader(appTwoSocket);
    await waitForOpen(appTwoSocket);
    await appTwoMessages.next("server.hello");
    appTwoSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-app-two-enc",
          type: "auth.attach",
          payload: {
            jwt: appTwoJwt.jwt,
          },
        },
        {
          from: appTwo.deviceId,
          signingKey: appTwoIdentity.privateKey,
        },
      ),
    );
    await nextEnvelopeMessage(appTwoMessages, "auth.token");

    appOneSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "workspace-list-enc-1",
          type: "workspace.list",
          payload: {},
        },
        {
          from: appOne.deviceId,
          sessionId: TransportControlSessionId,
          seq: 11,
          requestId: "workspace-list-enc-1",
          messageType: "workspace.list",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-one-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXJlcXVlc3Q",
          signingKey: appOneIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "workspace.list" &&
        envelope.request_id === "workspace-list-enc-1",
    );
    expect(forwarded).toMatchObject({
      from: appOne.deviceId,
      session_id: TransportControlSessionId,
      message_type: "workspace.list",
      cipher_mode: "noise_static_v1",
      request_id: "workspace-list-enc-1",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "workspace-list-enc-1",
          type: "workspace.list",
          payload: {
            default_path: "/tmp/workspace-enc",
            items: [
              {
                path: "/tmp/workspace-enc",
                name: "workspace-enc",
                status: "ready",
                is_default: true,
                entry_count: 1,
              },
            ],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          seq: 12,
          requestId: "workspace-list-enc-1",
          messageType: "workspace.list",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXJlc3BvbnNl",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const routed = await nextRawEnvelope(
      appOneMessages,
      (envelope) =>
        envelope.message_type === "workspace.list" &&
        envelope.request_id === "workspace-list-enc-1",
    );
    expect(routed).toMatchObject({
      from: daemonDevice.device_id,
      session_id: TransportControlSessionId,
      message_type: "workspace.list",
      cipher_mode: "noise_static_v1",
      request_id: "workspace-list-enc-1",
    });
    await expect(
      Promise.race([
        nextRawEnvelope(
          appTwoMessages,
          (envelope) =>
            envelope.message_type === "workspace.list" &&
            envelope.request_id === "workspace-list-enc-1",
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appOneSocket);
    await closeSocket(appTwoSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("rejects plaintext downgrade for metadata-bearing workspace.list requests", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "workspace-plain-request-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Workspace Plain Request App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

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
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "daemon-hello-plain-request-1",
          messageType: "daemon.hello",
          cipherMode: "noise_static_v1",
          routingPayload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-plain-workspace-1",
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
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "workspace-list-plain-request-1",
          type: "workspace.list",
          payload: {},
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "workspace-list-plain-request-1",
          messageType: "workspace.list",
          cipherMode: "plain",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "workspace-list-plain-request-1",
      session_id: null,
      code: "PROTOCOL_VERSION",
      message: "Envelope plaintext downgrade is not allowed for workspace.list",
    });

    await expect(
      Promise.race([
        nextEnvelopeMessage(daemonMessages, "workspace.list"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("rejects downgraded plaintext workspace.list responses after an encrypted request", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "workspace-plain-response-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Workspace Plain Response App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

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
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "daemon-hello-plain-response-1",
          messageType: "daemon.hello",
          cipherMode: "noise_static_v1",
          routingPayload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-plain-response-1",
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
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "workspace-list-enc-response-1",
          type: "workspace.list",
          payload: {},
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "workspace-list-enc-response-1",
          messageType: "workspace.list",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-plain-response-x25519",
          ciphertext: "ZW5jcnlwdGVkLXJlcXVlc3Q",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "workspace.list" &&
        envelope.request_id === "workspace-list-enc-response-1",
    );
    expect(forwarded).toMatchObject({
      message_type: "workspace.list",
      cipher_mode: "noise_static_v1",
      request_id: "workspace-list-enc-response-1",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "workspace-list-enc-response-1",
          type: "workspace.list",
          payload: {
            default_path: "/tmp/plain-response",
            items: [],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "workspace-list-enc-response-1",
          messageType: "workspace.list",
          cipherMode: "plain",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "workspace-list-enc-response-1",
      session_id: null,
      code: "PROTOCOL_VERSION",
      message:
        "Encrypted request requires noise_static_v1 response for workspace.list",
    });

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "workspace.list"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("fails pending workspace discovery requests immediately when daemon disconnects", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "workspace-pending-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Workspace Pending App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-workspace-pending-1",
    });

    await nextEnvelopeMessage(appMessages, "auth.token");
    const initialStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(initialStatus.message.payload.online).toBe(true);

    sendSignedMessage(
      appSocket,
      {
        v: 1,
        id: "workspace-list-pending-1",
        type: "workspace.list",
        payload: {},
      },
      {
        from: appDevice.deviceId,
        sessionId: TransportControlSessionId,
        requestId: "workspace-list-pending-1",
        messageType: "workspace.list",
        cipherMode: "noise_static_v1",
        senderPubkey: "workspace-pending-app-x25519",
        ciphertext: "ZW5jcnlwdGVkLXdvcmtzcGFjZS1wZW5kaW5n",
        signingKey: appIdentity.privateKey,
      },
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "workspace.list" &&
        envelope.request_id === "workspace-list-pending-1",
    );
    expect(forwarded.request_id).toBe("workspace-list-pending-1");
    expect(forwarded.cipher_mode).toBe("noise_static_v1");

    daemonSocket.close();

    const requestError = await nextEnvelopeMessage(appMessages, "error");
    expect(requestError.message.payload).toEqual({
      request_id: "workspace-list-pending-1",
      session_id: null,
      code: "SESSION_NOT_FOUND",
      message: "Target daemon went offline before responding",
    });

    const offlineStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(offlineStatus.message.payload.online).toBe(false);
    expect(offlineStatus.message.payload.active_session_count).toBe(0);

    await closeSocket(appSocket);
    await app.close();
  });

  it("fails pending workspace discovery requests when daemon stays online but does not respond", async () => {
    const { app, services } = await buildServer({
      relayPendingRequestTimeoutMs: 60,
    });
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "workspace-timeout-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Workspace Timeout App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-workspace-timeout-1",
    });

    await nextEnvelopeMessage(appMessages, "auth.token");
    const initialStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(initialStatus.message.payload.online).toBe(true);

    sendSignedMessage(
      appSocket,
      {
        v: 1,
        id: "workspace-list-timeout-1",
        type: "workspace.list",
        payload: {},
      },
      {
        from: appDevice.deviceId,
        sessionId: TransportControlSessionId,
        requestId: "workspace-list-timeout-1",
        messageType: "workspace.list",
        cipherMode: "noise_static_v1",
        senderPubkey: "workspace-timeout-app-x25519",
        ciphertext: "ZW5jcnlwdGVkLXdvcmtzcGFjZS10aW1lb3V0",
        signingKey: appIdentity.privateKey,
      },
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "workspace.list" &&
        envelope.request_id === "workspace-list-timeout-1",
    );
    expect(forwarded.request_id).toBe("workspace-list-timeout-1");
    expect(forwarded.cipher_mode).toBe("noise_static_v1");

    const requestError = await nextEnvelopeMessage(appMessages, "error");
    expect(requestError.message.payload).toEqual({
      request_id: "workspace-list-timeout-1",
      session_id: null,
      code: "SESSION_NOT_FOUND",
      message: "Target daemon timed out before responding",
    });

    sendSignedMessage(
      daemonSocket,
      {
        v: 1,
        id: "workspace-list-timeout-1",
        type: "workspace.list",
        payload: {
          default_path: "/tmp/late",
          items: [],
        },
      },
      {
        from: daemonDevice.device_id,
        signingKey: daemonIdentity.privateKey,
      },
    );

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "workspace.list"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("rejects pending session starts immediately when daemon disconnects", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "session-pending-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Session Pending App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-session-pending-1",
    });

    await nextEnvelopeMessage(appMessages, "auth.token");
    const initialStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(initialStatus.message.payload.online).toBe(true);

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-pending-1",
          type: "session.start",
          payload: {
            session_id: "session-pending-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-pending-1",
          requestId: "session-start-pending-1",
          messageType: "session.start",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-session-pending-x25519",
          ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
          routingPayload: {
            session_id: "session-pending-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextEnvelopeMessage(daemonMessages, "session.start");
    expect(forwarded.message.id).toBe("session-start-pending-1");

    daemonSocket.close();

    const rejected = await nextEnvelopeMessage(appMessages, "session.start.result");
    expect(rejected.message.payload).toEqual({
      request_id: "session-start-pending-1",
      session_id: "session-pending-1",
      agent_type: "shell",
      workspace_path: "/tmp/workspace",
      status: "rejected",
      code: "SESSION_NOT_FOUND",
      message: "Target daemon went offline before session started",
    });

    const offlineStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(offlineStatus.message.payload.online).toBe(false);
    expect(offlineStatus.message.payload.active_session_count).toBe(0);

    await closeSocket(appSocket);
    await app.close();
  });

  it("rejects pending session starts when daemon stays online but does not respond", async () => {
    const { app, services } = await buildServer({
      relayPendingSessionStartTimeoutMs: 80,
    });
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "session-timeout-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Session Timeout App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-session-timeout-1",
    });

    await nextEnvelopeMessage(appMessages, "auth.token");
    const initialStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(initialStatus.message.payload.online).toBe(true);

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-timeout-1",
          type: "session.start",
          payload: {
            session_id: "session-timeout-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-timeout-1",
          requestId: "session-start-timeout-1",
          messageType: "session.start",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-session-timeout-x25519",
          ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
          routingPayload: {
            session_id: "session-timeout-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextEnvelopeMessage(daemonMessages, "session.start");
    expect(forwarded.message.id).toBe("session-start-timeout-1");

    const rejected = await nextEnvelopeMessage(appMessages, "session.start.result");
    expect(rejected.message.payload).toEqual({
      request_id: "session-start-timeout-1",
      session_id: "session-timeout-1",
      agent_type: "shell",
      workspace_path: "/tmp/workspace",
      status: "rejected",
      code: "SESSION_NOT_FOUND",
      message: "Target daemon timed out before session started",
    });

    sendSignedMessage(
      daemonSocket,
      {
        v: 1,
        type: "session.start.result",
        payload: {
          request_id: "session-start-timeout-1",
          session_id: "session-timeout-1",
          agent_type: "shell",
          workspace_path: "/tmp/workspace",
          status: "started",
          message: "late start",
        },
      },
      {
        from: daemonDevice.device_id,
        signingKey: daemonIdentity.privateKey,
        sessionId: "session-timeout-1",
        requestId: "session-start-timeout-1",
        messageType: "session.start.result",
        cipherMode: "noise_static_v1",
        senderPubkey: "daemon-late-start-x25519",
        ciphertext: "bGF0ZS1zZXNzaW9uLXN0YXJ0",
        routingPayload: {
          status: "started",
        },
      },
    );

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "session.start.result"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("relays pairing, auth, session traffic, and presence updates", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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

    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "device.pair.ready",
          payload: {
            pairing_id: "pairing-1",
            pairing_code: "428791",
            expires_at: Date.now() + 30_000,
          },
        },
        {
          from: daemonDevice.device_id,
          messageType: "device.pair.ready",
          cipherMode: "noise_static_v1",
          routingPayload: {
            pairing_id: "pairing-1",
            pairing_code: "428791",
            expires_at: Date.now() + 30_000,
          },
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-start-plain-1",
          type: "device.pair",
          payload: {
            pairing_code: "428791",
            server_url: relayUrl,
            app_pubkey: "app-pub-key",
            app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
            app_device_name: "Test iPhone",
          },
        },
        {
          from: "app-instance-plain-1",
          requestId: "pair-start-plain-1",
          messageType: "device.pair",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            pairing_code: "428791",
            server_url: relayUrl,
            app_pubkey: "app-pub-key",
            app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
            app_device_name: "Test iPhone",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwardedPair = await nextEnvelopeMessage(daemonMessages, "device.pair");
    expect(forwardedPair.message.payload.app_device_name).toBe("Test iPhone");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-sas-plain-1",
          type: "device.pair.sas",
          payload: {
            sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
            noise_handshake: "noise-message-1",
            daemon_pubkey: "daemon-pub-key",
            daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
            machine_name: "CI-Mac",
            os: "darwin",
          },
        },
        {
          from: daemonDevice.device_id,
          requestId: "pair-sas-plain-1",
          messageType: "device.pair.sas",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
            noise_handshake: "noise-message-1",
            daemon_pubkey: "daemon-pub-key",
            daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
            machine_name: "CI-Mac",
            os: "darwin",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const sas = await nextEnvelopeMessage(appMessages, "device.pair.sas");
    expect(sas.message.payload.machine_name).toBe("CI-Mac");
    expect(sas.message.payload.noise_handshake).toBe("noise-message-1");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-confirm-plain-1",
          type: "device.pair.confirm",
          payload: {
            confirmed: true,
            noise_handshake: "noise-message-2",
          },
        },
        {
          from: "app-instance-plain-1",
          requestId: "pair-confirm-plain-1",
          messageType: "device.pair.confirm",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            confirmed: true,
            noise_handshake: "noise-message-2",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwardedConfirm = await nextEnvelopeMessage(
      daemonMessages,
      "device.pair.confirm",
    );
    expect(forwardedConfirm.message.payload.confirmed).toBe(true);
    expect(forwardedConfirm.message.payload.noise_handshake).toBe(
      "noise-message-2",
    );

    const authToken = await nextEnvelopeMessage(appMessages, "auth.token");
    expect(authToken.message.payload.jwt).toBeTypeOf("string");

    const onlineStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(onlineStatus.message.payload.online).toBe(true);
    expect(onlineStatus.message.payload.machine_name).toBe("CI-Mac");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-plain-1",
          type: "session.start",
          payload: {
            session_id: "session-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: parseJwtDeviceId(authToken.message.payload.jwt),
          sessionId: "session-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-session-start-pubkey-1",
          ciphertext: Buffer.from(
            "encrypted-session-start-1",
            "utf8",
          ).toString("base64url"),
          routingPayload: {
            session_id: "session-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwardedStart = await nextEnvelopeMessage(daemonMessages, "session.start");
    expect(forwardedStart.message.payload.session_id).toBe("session-1");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "session.start.result",
          payload: {
            request_id: forwardedStart.message.id,
            session_id: "session-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            status: "started",
            message: "Session started",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-start-result-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const startResult = await nextEnvelopeMessage(appMessages, "session.start.result");
    expect(startResult.message.payload.status).toBe("started");
    expect(startResult.message.payload.workspace_path).toBe("/tmp/workspace");
    const activeStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(activeStatus.message.payload.active_session_count).toBe(1);
    expect(activeStatus.message.payload.online).toBe(true);

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
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
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-event-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const sessionEvent = await nextEnvelopeMessage(appMessages, "session.event");
    expect(sessionEvent.message.payload.event.text).toBe("hello from daemon");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "session.event",
          payload: {
            session_id: "session-1",
            agent_id: null,
            agent_type: null,
            seq: 2,
            event: {
              event_type: "session.done",
              exit_code: 0,
              duration_ms: 1200,
            },
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-event-pubkey-1",
          routingPayload: {
            session_id: "session-1",
            agent_id: null,
            agent_type: null,
            seq: 2,
            event: {
              event_type: "session.done",
              exit_code: 0,
              duration_ms: 1200,
            },
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const sessionDone = await nextEnvelopeMessage(appMessages, "session.event");
    expect(sessionDone.message.payload.event.event_type).toBe("session.done");
    expect(sessionDone.message.payload.event.exit_code).toBe(0);

    const inactiveStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(inactiveStatus.message.payload.active_session_count).toBe(0);
    expect(inactiveStatus.message.payload.online).toBe(true);

    daemonSocket.close();
    const offlineStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(offlineStatus.message.payload.online).toBe(false);
    expect(offlineStatus.message.payload.machine_name).toBe("CI-Mac");
    expect(offlineStatus.message.payload.active_session_count).toBe(0);

    await closeSocket(appSocket);
    await app.close();
  });

  it("replays missing session events after app reconnects", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const appIdentity = createAppIdentity();
    const daemonIdentity = createDaemonIdentity();
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

    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "device.pair.ready",
          payload: {
            pairing_id: "pairing-2",
            pairing_code: "593274",
            expires_at: Date.now() + 30_000,
          },
        },
        {
          from: daemonDevice.device_id,
          messageType: "device.pair.ready",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            pairing_id: "pairing-2",
            pairing_code: "593274",
            expires_at: Date.now() + 30_000,
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-start-replay-1",
          type: "device.pair",
          payload: {
            pairing_code: "593274",
            server_url: relayUrl,
            app_pubkey: "app-pub-key",
            app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
            app_device_name: "Replay iPhone",
          },
        },
        {
          from: "app-instance-replay-1",
          requestId: "pair-start-replay-1",
          messageType: "device.pair",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            pairing_code: "593274",
            server_url: relayUrl,
            app_pubkey: "app-pub-key",
            app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
            app_device_name: "Replay iPhone",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(daemonMessages, "device.pair");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-sas-replay-1",
          type: "device.pair.sas",
          payload: {
            sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
            noise_handshake: "noise-message-1",
            daemon_pubkey: "daemon-pub-key",
            daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
            machine_name: "Replay-Mac",
            os: "darwin",
          },
        },
        {
          from: daemonDevice.device_id,
          requestId: "pair-sas-replay-1",
          messageType: "device.pair.sas",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
            noise_handshake: "noise-message-1",
            daemon_pubkey: "daemon-pub-key",
            daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
            machine_name: "Replay-Mac",
            os: "darwin",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(appMessages, "device.pair.sas");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-confirm-replay-1",
          type: "device.pair.confirm",
          payload: {
            confirmed: true,
            noise_handshake: "noise-message-2",
          },
        },
        {
          from: "app-instance-replay-1",
          requestId: "pair-confirm-replay-1",
          messageType: "device.pair.confirm",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            confirmed: true,
            noise_handshake: "noise-message-2",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(daemonMessages, "device.pair.confirm");
    const authToken = await nextEnvelopeMessage(appMessages, "auth.token");
    const appDeviceId = parseJwtDeviceId(authToken.message.payload.jwt);
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-replay-1",
          type: "session.start",
          payload: {
            session_id: "session-replay-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: appDeviceId,
          sessionId: "session-replay-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-session-replay-pubkey-1",
          ciphertext: Buffer.from(
            "encrypted-session-replay-start-1",
            "utf8",
          ).toString("base64url"),
          routingPayload: {
            session_id: "session-replay-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwardedStart = await nextEnvelopeMessage(daemonMessages, "session.start");
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "session.start.result",
          payload: {
            request_id: forwardedStart.message.id,
            session_id: "session-replay-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            status: "started",
            message: "Session started",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-result-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await nextEnvelopeMessage(appMessages, "session.start.result");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
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
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-event-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const firstEvent = await nextEnvelopeMessage(appMessages, "session.event");
    expect(firstEvent.message.payload.seq).toBe(1);

    await closeSocket(appSocket);

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
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
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-event-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
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
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-event-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    sendAuthAttach(resumedSocket, appIdentity, {
      deviceId: appDeviceId,
      jwt: authToken.message.payload.jwt,
      id: "auth-attach-session-replay-1",
    });

    await nextEnvelopeMessage(resumedMessages, "auth.token");
    await nextEnvelopeMessage(resumedMessages, "device.status");

    resumedSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-resume-replay-1",
          type: "session.resume",
          payload: {
            session_id: "session-replay-1",
            last_seq: firstEvent.envelope.seq,
          },
        },
        {
          from: appDeviceId,
          sessionId: "session-replay-1",
          requestId: "session-resume-replay-1",
          messageType: "session.resume",
          cipherMode: "noise_static_v1",
          routingPayload: {
            session_id: "session-replay-1",
            last_seq: firstEvent.envelope.seq,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const replayedSecond = await nextEnvelopeMessage(
      resumedMessages,
      "session.event",
    );
    expect(replayedSecond.message.payload.seq).toBe(2);
    expect(replayedSecond.message.payload.event.text).toBe("second chunk");

    const replayedThird = await nextEnvelopeMessage(
      resumedMessages,
      "session.event",
    );
    expect(replayedThird.message.payload.seq).toBe(3);
    expect(replayedThird.message.payload.event.text).toBe("third chunk");

    const replayDone = await nextEnvelopeMessage(resumedMessages, "replay.done");
    expect(replayDone.message.payload.session_id).toBe("session-replay-1");
    expect(replayDone.message.payload.replayed_count).toBe(2);
    expect(replayDone.message.payload.current_seq).toBe(replayedThird.envelope.seq);
    expect(replayDone.message.payload.status).toBe("ok");
    expect(replayDone.message.payload.message).toBe("Replay complete");

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("replays completed session events after daemon disconnects", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const appIdentity = createAppIdentity();
    const daemonIdentity = createDaemonIdentity();
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

    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "device.pair.ready",
          payload: {
            pairing_id: "pairing-3",
            pairing_code: "825146",
            expires_at: Date.now() + 30_000,
          },
        },
        {
          from: daemonDevice.device_id,
          messageType: "device.pair.ready",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            pairing_id: "pairing-3",
            pairing_code: "825146",
            expires_at: Date.now() + 30_000,
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-start-replay-complete-1",
          type: "device.pair",
          payload: {
            pairing_code: "825146",
            server_url: relayUrl,
            app_pubkey: "app-pub-key-replay-complete",
            app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
            app_device_name: "Replay Complete iPhone",
          },
        },
        {
          from: "app-instance-replay-complete-1",
          requestId: "pair-start-replay-complete-1",
          messageType: "device.pair",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            pairing_code: "825146",
            server_url: relayUrl,
            app_pubkey: "app-pub-key-replay-complete",
            app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
            app_device_name: "Replay Complete iPhone",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(daemonMessages, "device.pair");

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-sas-replay-complete-1",
          type: "device.pair.sas",
          payload: {
            sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
            noise_handshake: "noise-message-replay-complete-1",
            daemon_pubkey: "daemon-pub-key-replay-complete",
            daemon_ed25519_pubkey: "daemon-ed25519-pub-key-replay-complete",
            machine_name: "Replay-Complete-Mac",
            os: "darwin",
          },
        },
        {
          from: daemonDevice.device_id,
          requestId: "pair-sas-replay-complete-1",
          messageType: "device.pair.sas",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
            noise_handshake: "noise-message-replay-complete-1",
            daemon_pubkey: "daemon-pub-key-replay-complete",
            daemon_ed25519_pubkey: "daemon-ed25519-pub-key-replay-complete",
            machine_name: "Replay-Complete-Mac",
            os: "darwin",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(appMessages, "device.pair.sas");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-confirm-replay-complete-1",
          type: "device.pair.confirm",
          payload: {
            confirmed: true,
            noise_handshake: "noise-message-replay-complete-2",
          },
        },
        {
          from: "app-instance-replay-complete-1",
          requestId: "pair-confirm-replay-complete-1",
          messageType: "device.pair.confirm",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            confirmed: true,
            noise_handshake: "noise-message-replay-complete-2",
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(daemonMessages, "device.pair.confirm");
    const authToken = await nextEnvelopeMessage(appMessages, "auth.token");
    const appDeviceId = parseJwtDeviceId(authToken.message.payload.jwt);
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-replay-complete-1",
          type: "session.start",
          payload: {
            session_id: "session-replay-complete-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: appDeviceId,
          sessionId: "session-replay-complete-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-session-replay-complete-pubkey-1",
          ciphertext: Buffer.from(
            "encrypted-session-replay-complete-start-1",
            "utf8",
          ).toString("base64url"),
          routingPayload: {
            session_id: "session-replay-complete-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwardedStart = await nextEnvelopeMessage(daemonMessages, "session.start");
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "session.start.result",
          payload: {
            request_id: forwardedStart.message.id,
            session_id: "session-replay-complete-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            status: "started",
            message: "Session started",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-complete-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-complete-result-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(appMessages, "session.start.result");
    const activeStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(activeStatus.message.payload.active_session_count).toBe(1);
    expect(activeStatus.message.payload.online).toBe(true);

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "session.event",
          payload: {
            session_id: "session-replay-complete-1",
            agent_id: null,
            agent_type: null,
            seq: 1,
            event: {
              event_type: "assistant.delta",
              text: "first chunk",
            },
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-complete-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-complete-event-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "session.event",
          payload: {
            session_id: "session-replay-complete-1",
            agent_id: null,
            agent_type: null,
            seq: 2,
            event: {
              event_type: "assistant.delta",
              text: "second chunk",
            },
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-complete-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-complete-event-pubkey-1",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "session.event",
          payload: {
            session_id: "session-replay-complete-1",
            agent_id: null,
            agent_type: null,
            seq: 3,
            event: {
              event_type: "session.done",
              exit_code: 0,
              duration_ms: 3200,
            },
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-replay-complete-1",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-session-replay-complete-event-pubkey-1",
          routingPayload: {
            session_id: "session-replay-complete-1",
            agent_id: null,
            agent_type: null,
            seq: 3,
            event: {
              event_type: "session.done",
              exit_code: 0,
              duration_ms: 3200,
            },
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const firstEvent = await nextEnvelopeMessage(appMessages, "session.event");
    expect(firstEvent.message.payload.seq).toBe(1);
    expect(firstEvent.message.payload.event.text).toBe("first chunk");

    const secondEvent = await nextEnvelopeMessage(appMessages, "session.event");
    expect(secondEvent.message.payload.seq).toBe(2);
    expect(secondEvent.message.payload.event.text).toBe("second chunk");

    const sessionDone = await nextEnvelopeMessage(appMessages, "session.event");
    expect(sessionDone.message.payload.seq).toBe(3);
    expect(sessionDone.message.payload.event.event_type).toBe("session.done");

    const completedStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(completedStatus.message.payload.active_session_count).toBe(0);
    expect(completedStatus.message.payload.online).toBe(true);

    await closeSocket(appSocket);
    daemonSocket.close();

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    sendAuthAttach(resumedSocket, appIdentity, {
      deviceId: appDeviceId,
      jwt: authToken.message.payload.jwt,
      id: "auth-attach-session-replay-complete-1",
    });

    await nextEnvelopeMessage(resumedMessages, "auth.token");
    const offlineStatus = await nextEnvelopeMessage(resumedMessages, "device.status");
    expect(offlineStatus.message.payload.online).toBe(false);
    expect(offlineStatus.message.payload.active_session_count).toBe(0);
    expect(offlineStatus.message.payload.machine_name).toBe("Replay-Complete-Mac");

    resumedSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-resume-replay-complete-1",
          type: "session.resume",
          payload: {
            session_id: "session-replay-complete-1",
            last_seq: firstEvent.envelope.seq,
          },
        },
        {
          from: appDeviceId,
          sessionId: "session-replay-complete-1",
          requestId: "session-resume-replay-complete-1",
          messageType: "session.resume",
          cipherMode: "noise_static_v1",
          routingPayload: {
            session_id: "session-replay-complete-1",
            last_seq: firstEvent.envelope.seq,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const replayedSecond = await nextEnvelopeMessage(
      resumedMessages,
      "session.event",
    );
    expect(replayedSecond.message.payload.seq).toBe(2);
    expect(replayedSecond.message.payload.event.text).toBe("second chunk");

    const replayedDone = await nextEnvelopeMessage(
      resumedMessages,
      "session.event",
    );
    expect(replayedDone.message.payload.seq).toBe(3);
    expect(replayedDone.message.payload.event.event_type).toBe("session.done");
    expect(replayedDone.message.payload.event.exit_code).toBe(0);

    const replayDone = await nextEnvelopeMessage(resumedMessages, "replay.done");
    expect(replayDone.message.payload.session_id).toBe(
      "session-replay-complete-1",
    );
    expect(replayDone.message.payload.replayed_count).toBe(2);
    expect(replayDone.message.payload.current_seq).toBe(replayedDone.envelope.seq);
    expect(replayDone.message.payload.status).toBe("ok");
    expect(replayDone.message.payload.message).toBe("Replay complete");

    await closeSocket(resumedSocket);
    await app.close();
  });

  it("replays pending danger approvals after app reconnects", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-danger-replay-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Danger Replay App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-danger-replay-1",
    });
    await nextEnvelopeMessage(appMessages, "auth.token");
    await nextEnvelopeMessage(appMessages, "device.status");

    services.sessionRegistry.register(
      "session-danger-replay-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    await closeSocket(appSocket);

    const timeoutAt = Date.now() + 60_000;
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
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
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-danger-replay-1",
          messageType: "danger.pending",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-danger-replay-pubkey-1",
          routingPayload: {
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
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await waitFor(() => services.pendingDangers.getSize() === 1);

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    sendAuthAttach(resumedSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-danger-replay-resume-1",
    });

    await nextEnvelopeMessage(resumedMessages, "auth.token");
    await nextEnvelopeMessage(resumedMessages, "device.status");

    const pending = await nextEnvelopeMessage(resumedMessages, "danger.pending");
    expect(pending.message.payload.danger_id).toBe("danger-replay-1");
    expect(pending.message.payload.session_id).toBe("session-danger-replay-1");
    expect(pending.message.payload.tool_name).toBe("bash");
    expect(pending.message.payload.command).toBe("rm -rf /tmp/demo");
    expect(pending.message.payload.timeout_at).toBe(timeoutAt);

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("does not replay resolved pending danger approvals after reconnect", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-danger-resolved-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Danger Resolved App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-danger-resolved-1",
    });
    await nextEnvelopeMessage(appMessages, "auth.token");
    await nextEnvelopeMessage(appMessages, "device.status");

    services.sessionRegistry.register(
      "session-danger-resolved-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
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
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-danger-resolved-1",
          messageType: "danger.pending",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-danger-resolved-pubkey-1",
          routingPayload: {
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
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const pending = await nextEnvelopeMessage(appMessages, "danger.pending");
    expect(pending.message.payload.danger_id).toBe("danger-resolved-1");
    await waitFor(() => services.pendingDangers.getSize() === 1);

    sendSignedMessage(
      appSocket,
      {
        v: 1,
        id: "danger-allow-resolved-1",
        type: "danger.allow",
        payload: {
          session_id: "session-danger-resolved-1",
          danger_id: "danger-resolved-1",
          biometric_verified: true,
        },
      },
      {
        from: appDevice.deviceId,
        sessionId: "session-danger-resolved-1",
        requestId: "danger-allow-resolved-1",
        messageType: "danger.allow",
        cipherMode: "noise_static_v1",
        senderPubkey: "app-danger-allow-x25519",
        ciphertext: "ZW5jcnlwdGVkLWRhbmdlci1hbGxvdw",
        routingPayload: {
          session_id: "session-danger-resolved-1",
          danger_id: "danger-resolved-1",
          biometric_verified: true,
        },
        signingKey: appIdentity.privateKey,
      },
    );

    const allow = await nextEnvelopeMessage(daemonMessages, "danger.allow");
    expect(allow.message.payload.danger_id).toBe("danger-resolved-1");
    await waitFor(() => services.pendingDangers.getSize() === 0);

    await closeSocket(appSocket);

    const resumedSocket = new WebSocket(relayUrl);
    const resumedMessages = createMessageReader(resumedSocket);
    await waitForOpen(resumedSocket);
    await resumedMessages.next("server.hello");

    sendAuthAttach(resumedSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-danger-resolved-resume-1",
    });

    await nextEnvelopeMessage(resumedMessages, "auth.token");
    await nextEnvelopeMessage(resumedMessages, "device.status");

    let replayedDanger = false;
    try {
      await Promise.race([
        nextEnvelopeMessage(resumedMessages, "danger.pending").then(() => {
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
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-danger-result-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Danger Result App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-danger-result-1",
    });
    await nextEnvelopeMessage(appMessages, "auth.token");
    await nextEnvelopeMessage(appMessages, "device.status");

    services.sessionRegistry.register(
      "session-danger-result-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
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
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-danger-result-1",
          messageType: "danger.pending",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-danger-result-pending-pubkey-1",
          routingPayload: {
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
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await nextEnvelopeMessage(appMessages, "danger.pending");
    await waitFor(() => services.pendingDangers.getSize() == 1);

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "danger.result",
          payload: {
            danger_id: "danger-result-1",
            session_id: "session-danger-result-1",
            status: "timed_out",
            message: "Danger approval timed out",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-danger-result-1",
          messageType: "danger.result",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-danger-result-pubkey-1",
          routingPayload: {
            danger_id: "danger-result-1",
            session_id: "session-danger-result-1",
            status: "timed_out",
            message: "Danger approval timed out",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const result = await nextEnvelopeMessage(appMessages, "danger.result");
    expect(result.message.payload).toEqual({
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
    sendAuthAttach(resumedSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-danger-result-resume-1",
    });

    await nextEnvelopeMessage(resumedMessages, "auth.token");
    await nextEnvelopeMessage(resumedMessages, "device.status");

    let replayedDanger = false;
    try {
      await Promise.race([
        nextEnvelopeMessage(resumedMessages, "danger.pending").then(() => {
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
    const daemonIdentity = createDaemonIdentity();
    const appAIdentity = createAppIdentity();
    const appBIdentity = createAppIdentity();
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
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appA = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-a-pub",
      appEd25519PubKey: appAIdentity.publicKeyBase64Url,
      appDeviceName: "App A",
    });
    const appB = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-b-pub",
      appEd25519PubKey: appBIdentity.publicKeyBase64Url,
      appDeviceName: "App B",
    });
    const jwtA = await services.jwtManager.issue(appA.deviceId);
    const jwtB = await services.jwtManager.issue(appB.deviceId);

    const appSocketA = new WebSocket(relayUrl);
    const appMessagesA = createMessageReader(appSocketA);
    await waitForOpen(appSocketA);
    await appMessagesA.next("server.hello");
    sendAuthAttach(appSocketA, appAIdentity, {
      deviceId: appA.deviceId,
      jwt: jwtA.jwt,
      id: "auth-attach-ratchet-app-a",
    });
    await nextEnvelopeMessage(appMessagesA, "auth.token");

    const appSocketB = new WebSocket(relayUrl);
    const appMessagesB = createMessageReader(appSocketB);
    await waitForOpen(appSocketB);
    await appMessagesB.next("server.hello");
    sendAuthAttach(appSocketB, appBIdentity, {
      deviceId: appB.deviceId,
      jwt: jwtB.jwt,
      id: "auth-attach-ratchet-app-b",
    });
    await nextEnvelopeMessage(appMessagesB, "auth.token");

    services.sessionRegistry.register(
      "session-ratchet-1",
      appA.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "key-ratchet-1",
          type: "key.ratchet",
          payload: {
            session_id: "session-ratchet-1",
            next_pubkey: "next-ratchet-pubkey",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-ratchet-1",
          requestId: "key-ratchet-1",
          messageType: "key.ratchet",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-x25519-ratchet-pub",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const ratchet = await nextEnvelopeMessage(appMessagesA, "key.ratchet");
    expect(ratchet.message.payload.session_id).toBe("session-ratchet-1");

    let appBReceivedRatchet = false;
    try {
      await Promise.race([
        nextEnvelopeMessage(appMessagesB, "key.ratchet").then(() => {
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

  it("rejects downgraded plaintext session.event for encrypted sessions", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-session-event-plain-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Session Event Plain App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-session-event-plain-1",
    });
    await nextEnvelopeMessage(appMessages, "auth.token");

    services.sessionRegistry.register(
      "session-event-enc-1",
      appDevice.deviceId,
      daemonDevice.device_id,
      true,
    );

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "event-plain-1",
          type: "session.event",
          payload: {
            session_id: "session-event-enc-1",
            agent_id: null,
            agent_type: null,
            seq: 1,
            event: {
              event_type: "assistant.delta",
              text: "plaintext should be rejected",
            },
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-event-enc-1",
          requestId: "event-plain-1",
          messageType: "session.event",
          cipherMode: "plain",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "event-plain-1",
      session_id: "session-event-enc-1",
      code: "PROTOCOL_VERSION",
      message:
        "Encrypted session requires noise_static_v1 transport for session.event",
    });

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "session.event"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("rejects downgraded plaintext fs.tree responses for encrypted sessions", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const relayUrl = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-fs-tree-plain-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "FsTree Plain App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-fs-tree-plain-1",
    });
    await nextEnvelopeMessage(appMessages, "auth.token");
    await nextEnvelopeMessage(appMessages, "device.status");

    services.sessionRegistry.register(
      "session-fs-tree-enc-1",
      appDevice.deviceId,
      daemonDevice.device_id,
      true,
    );

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "fs-tree-plain-1",
          type: "fs.tree.req",
          payload: {
            session_id: "session-fs-tree-enc-1",
            workspace_path: "/tmp/workspace",
            dir_path: "",
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-fs-tree-enc-1",
          requestId: "fs-tree-plain-1",
          messageType: "fs.tree.req",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-fs-tree-plain-x25519",
          ciphertext: "ZW5jcnlwdGVkLWZzLXRyZWUtcmVx",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "fs.tree.req" &&
        envelope.request_id === "fs-tree-plain-1",
    );
    expect(forwarded).toMatchObject({
      message_type: "fs.tree.req",
      cipher_mode: "noise_static_v1",
      request_id: "fs-tree-plain-1",
      session_id: "session-fs-tree-enc-1",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "fs-tree-plain-1",
          type: "fs.tree",
          payload: {
            session_id: "session-fs-tree-enc-1",
            workspace_path: "/tmp/workspace",
            dir_path: "",
            entries: [
              {
                name: "lib",
                path: "/tmp/workspace/lib",
                type: "dir",
                modified: null,
                size: 0,
              },
            ],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-fs-tree-enc-1",
          requestId: "fs-tree-plain-1",
          messageType: "fs.tree",
          cipherMode: "plain",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "fs-tree-plain-1",
      session_id: "session-fs-tree-enc-1",
      code: "PROTOCOL_VERSION",
      message:
        "Encrypted request requires noise_static_v1 response for fs.tree.req",
    });

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "fs.tree"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("routes session-scoped daemon utility messages only to the owning app", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const daemonIdentity = createDaemonIdentity();
    const appAIdentity = createAppIdentity();
    const appBIdentity = createAppIdentity();
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
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });

    const appA = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-a-pub-session",
      appEd25519PubKey: appAIdentity.publicKeyBase64Url,
      appDeviceName: "App A",
    });
    const appB = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-b-pub-session",
      appEd25519PubKey: appBIdentity.publicKeyBase64Url,
      appDeviceName: "App B",
    });
    const jwtA = await services.jwtManager.issue(appA.deviceId);
    const jwtB = await services.jwtManager.issue(appB.deviceId);

    const appSocketA = new WebSocket(relayUrl);
    const appMessagesA = createMessageReader(appSocketA);
    await waitForOpen(appSocketA);
    await appMessagesA.next("server.hello");
    sendAuthAttach(appSocketA, appAIdentity, {
      deviceId: appA.deviceId,
      jwt: jwtA.jwt,
      id: "auth-attach-history-app-a",
    });
    await nextEnvelopeMessage(appMessagesA, "auth.token");

    const appSocketB = new WebSocket(relayUrl);
    const appMessagesB = createMessageReader(appSocketB);
    await waitForOpen(appSocketB);
    await appMessagesB.next("server.hello");
    sendAuthAttach(appSocketB, appBIdentity, {
      deviceId: appB.deviceId,
      jwt: jwtB.jwt,
      id: "auth-attach-history-app-b",
    });
    await nextEnvelopeMessage(appMessagesB, "auth.token");

    services.sessionRegistry.register(
      "session-history-1",
      appA.deviceId,
      daemonDevice.device_id,
    );

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "history.get",
          payload: {
            session_id: "session-history-1",
            offset: 0,
            total: 1,
            lines: ['{"type":"assistant","message":"hello"}'],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-history-1",
          messageType: "history.get",
          cipherMode: "plain",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const historyForA = await nextEnvelopeMessage(appMessagesA, "history.get");
    expect(historyForA.message.payload.session_id).toBe("session-history-1");
    expect(historyForA.message.payload.lines).toEqual([
      '{"type":"assistant","message":"hello"}',
    ]);

    let appBReceivedHistory = false;
    try {
      await Promise.race([
        nextEnvelopeMessage(appMessagesB, "history.get").then(() => {
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

  it("rejects downgraded plaintext history.get responses after an encrypted request", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "history-get-plain-response-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "History Plain Response App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

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
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "daemon-hello-history-plain-1",
          messageType: "daemon.hello",
          cipherMode: "noise_static_v1",
          routingPayload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    services.sessionRegistry.register(
      "session-history-enc-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-history-plain-1",
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
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "history-get-enc-response-1",
          type: "history.get",
          payload: {
            session_id: "session-history-enc-1",
            offset: 0,
            limit: 20,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-history-enc-1",
          requestId: "history-get-enc-response-1",
          messageType: "history.get",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-history-x25519",
          ciphertext: "ZW5jcnlwdGVkLWhpc3RvcnktcmVx",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "history.get" &&
        envelope.request_id === "history-get-enc-response-1",
    );
    expect(forwarded).toMatchObject({
      message_type: "history.get",
      cipher_mode: "noise_static_v1",
      request_id: "history-get-enc-response-1",
      session_id: "session-history-enc-1",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "history-get-enc-response-1",
          type: "history.get",
          payload: {
            session_id: "session-history-enc-1",
            offset: 0,
            total: 1,
            lines: ['{"type":"assistant","message":"plain"}'],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-history-enc-1",
          requestId: "history-get-enc-response-1",
          messageType: "history.get",
          cipherMode: "plain",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "history-get-enc-response-1",
      session_id: "session-history-enc-1",
      code: "PROTOCOL_VERSION",
      message: "Encrypted request requires noise_static_v1 response for history.get",
    });

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "history.get"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("fails pending encrypted history.get requests with a session-scoped timeout error", async () => {
    const { app, services } = await buildServer({
      relayPendingRequestTimeoutMs: 60,
    });
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "history-get-timeout-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "History Timeout App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

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
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "daemon-hello-history-timeout-1",
          messageType: "daemon.hello",
          cipherMode: "noise_static_v1",
          routingPayload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    services.sessionRegistry.register(
      "session-history-timeout-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-history-timeout-1",
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
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "history-get-timeout-1",
          type: "history.get",
          payload: {
            session_id: "session-history-timeout-1",
            offset: 0,
            limit: 20,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-history-timeout-1",
          requestId: "history-get-timeout-1",
          messageType: "history.get",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-history-timeout-x25519",
          ciphertext: "ZW5jcnlwdGVkLWhpc3RvcnktdGltZW91dA",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "history.get" &&
        envelope.request_id === "history-get-timeout-1",
    );
    expect(forwarded).toMatchObject({
      message_type: "history.get",
      cipher_mode: "noise_static_v1",
      request_id: "history-get-timeout-1",
      session_id: "session-history-timeout-1",
    });

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "history-get-timeout-1",
      session_id: "session-history-timeout-1",
      code: "SESSION_NOT_FOUND",
      message: "Target daemon timed out before responding",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          type: "error",
          payload: {
            request_id: "history-get-timeout-1",
            session_id: "session-history-timeout-1",
            code: "SESSION_NOT_FOUND",
            message: "late daemon error",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-history-timeout-1",
          requestId: "history-get-timeout-1",
          messageType: "error",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-history-timeout-x25519",
          routingPayload: {
            request_id: "history-get-timeout-1",
            session_id: "session-history-timeout-1",
            code: "SESSION_NOT_FOUND",
            message: "late daemon error",
          },
          ciphertext: "bGF0ZS1oaXN0b3J5LWVycm9y",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "error"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("rejects downgraded plaintext slash.list responses after an encrypted request", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "slash-list-plain-response-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Slash List Encrypted Response App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

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
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "daemon-hello-slash-enc-response-1",
          messageType: "daemon.hello",
          cipherMode: "noise_static_v1",
          routingPayload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session"],
          },
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    services.sessionRegistry.register(
      "session-slash-enc-1",
      appDevice.deviceId,
      daemonDevice.device_id,
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-slash-enc-response-1",
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
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "slash-list-enc-response-1",
          type: "slash.list",
          payload: {
            session_id: "session-slash-enc-1",
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-slash-enc-1",
          requestId: "slash-list-enc-response-1",
          messageType: "slash.list",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-slash-x25519",
          ciphertext: "ZW5jcnlwdGVkLXNsYXNoLXJlcQ",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "slash.list" &&
        envelope.request_id === "slash-list-enc-response-1",
    );
    expect(forwarded).toMatchObject({
      message_type: "slash.list",
      cipher_mode: "noise_static_v1",
      request_id: "slash-list-enc-response-1",
      session_id: "session-slash-enc-1",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "slash-list-enc-response-1",
          type: "slash.list",
          payload: {
            session_id: "session-slash-enc-1",
            commands: [
              {
                name: "/review",
                desc: "Run review",
              },
            ],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-slash-enc-1",
          requestId: "slash-list-enc-response-1",
          messageType: "slash.list",
          cipherMode: "plain",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "slash-list-enc-response-1",
      session_id: "session-slash-enc-1",
      code: "PROTOCOL_VERSION",
      message: "Encrypted request requires noise_static_v1 response for slash.list",
    });

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "slash.list"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
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
    const pairReadyExpiresAt = Date.now() + 30_000;
    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "pair-ready-1",
          type: "device.pair.ready",
          payload: {
            pairing_id: "pairing-envelope-1",
            pairing_code: "771244",
            expires_at: pairReadyExpiresAt,
          },
        },
        {
          from: daemonDevice.device_id,
          requestId: "pair-ready-1",
          messageType: "device.pair.ready",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            pairing_id: "pairing-envelope-1",
            pairing_code: "771244",
            expires_at: pairReadyExpiresAt,
          },
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
        requestId: "pair-start-1",
        messageType: "device.pair",
        cipherMode: "noise_static_v1",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        routingPayload: {
          pairing_code: "771244",
          server_url: relayUrl,
          app_pubkey: "app-pub-key-envelope",
          app_ed25519_pubkey: appIdentity.publicKeyBase64Url,
          app_device_name: "Envelope iPhone",
        },
        signingKey: appIdentity.privateKey,
      },
    );
    const pairStartEnvelope = JSON.parse(pairStartRaw) as { sig: string };
    appSocket.send(pairStartRaw);

    const forwardedPair = await nextEnvelopeMessage(
      daemonMessages,
      "device.pair",
    );
    expect(forwardedPair.envelope.cipher_mode).toBe("noise_static_v1");
    expect(forwardedPair.envelope.session_id).toBe("");
    expect(forwardedPair.envelope.ciphertext).toBe(
      Buffer.from("opaque", "utf8").toString("base64url"),
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
        requestId: "pair-sas-1",
        messageType: "device.pair.sas",
        cipherMode: "noise_static_v1",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        routingPayload: {
          sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
          noise_handshake: "noise-message-1",
          daemon_pubkey: "daemon-pub-key",
          daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
          machine_name: "Envelope-Mac",
          os: "darwin",
        },
        signingKey: daemonIdentity.privateKey,
      },
    );
    const pairSasEnvelope = JSON.parse(pairSasRaw) as { sig: string };
    daemonSocket.send(pairSasRaw);

    const sas = await nextEnvelopeMessage(appMessages, "device.pair.sas");
    expect(sas.envelope.cipher_mode).toBe("noise_static_v1");
    expect(sas.envelope.session_id).toBe("");
    expect(sas.envelope.ciphertext).toBe(
      Buffer.from("opaque", "utf8").toString("base64url"),
    );
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
        requestId: "pair-confirm-1",
        messageType: "device.pair.confirm",
        cipherMode: "noise_static_v1",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        routingPayload: {
          confirmed: true,
          noise_handshake: "noise-message-2",
        },
        signingKey: appIdentity.privateKey,
      },
    );
    const pairConfirmEnvelope = JSON.parse(pairConfirmRaw) as { sig: string };
    appSocket.send(pairConfirmRaw);

    const forwardedConfirm = await nextEnvelopeMessage(
      daemonMessages,
      "device.pair.confirm",
    );
    expect(forwardedConfirm.envelope.cipher_mode).toBe("noise_static_v1");
    expect(forwardedConfirm.envelope.session_id).toBe("");
    expect(forwardedConfirm.envelope.ciphertext).toBe(
      Buffer.from("opaque", "utf8").toString("base64url"),
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
    expect(authToken.envelope.cipher_mode).toBe("noise_static_v1");
    expect(authToken.envelope.message_type).toBe("auth.token");
    expect(authToken.envelope.session_id).toBe(TransportControlSessionId);
    expect(typeof authToken.envelope.routing_payload).toBe("string");
    const appDeviceId = parseJwtDeviceId(authToken.message.payload.jwt);
    expect(authToken.message.payload.jwt).toBeTypeOf("string");
    expect(onlineStatus.message.payload.machine_name).toBe("Envelope-Mac");
    expect(onlineStatus.envelope.cipher_mode).toBe("noise_static_v1");
    expect(onlineStatus.envelope.message_type).toBe("device.status");
    expect(typeof onlineStatus.envelope.routing_payload).toBe("string");

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
        cipherMode: "noise_static_v1",
        senderPubkey: "app-session-envelope-pubkey-1",
        ciphertext: Buffer.from(
          "encrypted-session-envelope-start-1",
          "utf8",
        ).toString("base64url"),
        routingPayload: {
          session_id: "session-envelope-1",
          agent_type: "claude_code",
          workspace_path: "/tmp/workspace",
          resume_session_id: null,
        },
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
        seq: 4,
        cipherMode: "noise_static_v1",
        senderPubkey: "daemon-session-envelope-result-pubkey-1",
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
        seq: 5,
        cipherMode: "noise_static_v1",
        senderPubkey: "daemon-session-envelope-event-pubkey-1",
        signingKey: daemonIdentity.privateKey,
      },
    );
    const firstEventEnvelope = JSON.parse(firstEventRaw) as { sig: string };
    daemonSocket.send(firstEventRaw);

    const firstEvent = await nextEnvelopeMessage(appMessages, "session.event");
    expect(firstEvent.message.payload.seq).toBe(1);
    expect(firstEvent.envelope.seq).toBe(5);
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
        seq: 6,
        cipherMode: "noise_static_v1",
        senderPubkey: "daemon-session-envelope-event-pubkey-1",
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
          id: "session-resume-1",
          type: "session.resume",
          payload: {
            session_id: "session-envelope-1",
            last_seq: 5,
          },
        },
        {
          from: appDeviceId,
          sessionId: "session-envelope-1",
          requestId: "session-resume-1",
          routingPayload: {
            session_id: "session-envelope-1",
            last_seq: 5,
          },
          messageType: "session.resume",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-sender-pubkey",
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
    expect(replayDone.message.payload.current_seq).toBe(6);
    expect(replayDone.message.payload.status).toBe("ok");
    expect(replayDone.message.payload.message).toBe("Replay complete");
    expect(replayDone.envelope.seq).toBe(7);

    await closeSocket(resumedSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("routes encrypted session.start.result envelopes after an encrypted session.start", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "session-start-enc-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Encrypted Start App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

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
          id: "daemon-hello-start-enc",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session", "pty"],
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
    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-start-enc",
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
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-enc-1",
          type: "session.start",
          payload: {
            session_id: "session-start-enc-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-start-enc-1",
          requestId: "session-start-enc-1",
          messageType: "session.start",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwardedStart = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "session.start" &&
        envelope.request_id === "session-start-enc-1",
    );
    expect(forwardedStart).toMatchObject({
      from: appDevice.deviceId,
      session_id: "session-start-enc-1",
      message_type: "session.start",
      cipher_mode: "noise_static_v1",
      request_id: "session-start-enc-1",
      sender_pubkey: "app-x25519-pubkey",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-enc-1",
          type: "session.start.result",
          payload: {
            request_id: "session-start-enc-1",
            session_id: "session-start-enc-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            status: "started",
            message: "Session started",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-start-enc-1",
          seq: 21,
          requestId: "session-start-enc-1",
          messageType: "session.start.result",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXN0YXJ0LXJlc3VsdA",
          routingPayload: {
            status: "started",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const startResult = await nextRawEnvelope(
      appMessages,
      (envelope) =>
        envelope.message_type === "session.start.result" &&
        envelope.request_id === "session-start-enc-1",
    );
    expect(startResult).toMatchObject({
      from: daemonDevice.device_id,
      session_id: "session-start-enc-1",
      message_type: "session.start.result",
      cipher_mode: "noise_static_v1",
      request_id: "session-start-enc-1",
      sender_pubkey: "daemon-x25519-pubkey",
    });
    expect(typeof startResult.routing_payload).toBe("string");

    const activeStatus = await nextEnvelopeMessage(appMessages, "device.status");
    expect(activeStatus.message.payload.active_session_count).toBe(1);
    expect(activeStatus.message.payload.online).toBe(true);

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("rejects downgraded plaintext session.start.result responses after an encrypted session.start", async () => {
    const { app, services } = await buildServer();
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "session-start-plain-response-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Plain Start Response App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

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
          id: "daemon-hello-start-plain",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["e2ee_noise_ik", "multi_session", "pty"],
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
    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-start-plain",
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
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-plain-response-1",
          type: "session.start",
          payload: {
            session_id: "session-start-plain-response-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-start-plain-response-1",
          requestId: "session-start-plain-response-1",
          messageType: "session.start",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-x25519-start-plain-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwardedStart = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "session.start" &&
        envelope.request_id === "session-start-plain-response-1",
    );
    expect(forwardedStart).toMatchObject({
      message_type: "session.start",
      cipher_mode: "noise_static_v1",
      request_id: "session-start-plain-response-1",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-plain-response-1",
          type: "session.start.result",
          payload: {
            request_id: "session-start-plain-response-1",
            session_id: "session-start-plain-response-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            status: "started",
            message: "Session started",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-start-plain-response-1",
          requestId: "session-start-plain-response-1",
          messageType: "session.start.result",
          cipherMode: "plain",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const rejected = await nextEnvelopeMessage(
      appMessages,
      "session.start.result",
    );
    expect(rejected.message.payload).toEqual({
      request_id: "session-start-plain-response-1",
      session_id: "session-start-plain-response-1",
      agent_type: "shell",
      workspace_path: "/tmp/workspace",
      status: "rejected",
      code: "PROTOCOL_VERSION",
      message:
        "Encrypted session.start requires noise_static_v1 session.start.result",
    });

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "device.status"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
  });

  it("returns opaque envelope errors with the original request id for authenticated envelope apps", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-envelope-error",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();
    const appIdentity = createAppIdentity();
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-envelope-error-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Envelope Error App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-envelope-error-1",
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
          id: "workspace-list-envelope-error-1",
          type: "workspace.list",
          payload: {},
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "workspace-list-envelope-error-1",
          messageType: "workspace.list",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-sender-pubkey",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.envelope.cipher_mode).toBe("noise_static_v1");
    expect(error.envelope.message_type).toBe("error");
    expect(error.envelope.session_id).toBe(TransportControlSessionId);
    expect(error.envelope.request_id).toBe("workspace-list-envelope-error-1");
    expect(error.message.payload).toEqual({
      request_id: "workspace-list-envelope-error-1",
      session_id: null,
      code: "SESSION_NOT_FOUND",
      message: "Target daemon is offline",
    });

    await closeSocket(appSocket);
    await app.close();
  });

  it("rejects plaintext downgrade for auth.attach metadata envelopes", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-envelope-downgrade",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();
    const appIdentity = createAppIdentity();
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-envelope-downgrade-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Envelope Downgrade App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-downgrade-1",
          type: "auth.attach",
          payload: {
            jwt: jwt.jwt,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: TransportControlSessionId,
          requestId: "auth-attach-downgrade-1",
          messageType: "auth.attach",
          cipherMode: "plain",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "auth-attach-downgrade-1",
      session_id: null,
      code: "PROTOCOL_VERSION",
      message: "Envelope plaintext downgrade is not allowed for auth.attach",
    });

    await closeSocket(appSocket);
    await app.close();
  });

  it("rejects signed envelopes whose timestamp exceeds allowed skew", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-envelope-skew",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();
    const appIdentity = createAppIdentity();
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-envelope-skew-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Envelope Skew App",
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
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-envelope-skew-1",
          type: "auth.attach",
          payload: {
            jwt: jwt.jwt,
          },
        },
        {
          from: appDevice.deviceId,
          ts: Date.now() - 5 * 60 * 1000 - 1,
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "relay",
      session_id: null,
      code: "AUTH_INVALID",
      message: "Envelope timestamp exceeds allowed skew",
    });

    await closeSocket(appSocket);
    await app.close();
  });

  it("rejects replayed signed envelopes across connections", async () => {
    const { app, services } = await buildServer();
    const bootstrap = services.bootstrapTokens.issueToken();
    const registered = await app.inject({
      method: "POST",
      url: "/v1/register",
      payload: {
        device_pub_key: "device-pub-key-envelope-replay",
        bootstrap_token: bootstrap.token,
      },
    });

    expect(registered.statusCode).toBe(201);
    const daemonDevice = registered.json();
    const appIdentity = createAppIdentity();
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-envelope-replay-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Envelope Replay App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const replayedAttach = encodeEnvelope(
      {
        v: 1,
        id: "auth-attach-envelope-replay-1",
        type: "auth.attach",
        payload: {
          jwt: jwt.jwt,
        },
      },
      {
        from: appDevice.deviceId,
        signingKey: appIdentity.privateKey,
      },
    );

    const firstSocket = new WebSocket(relayUrl);
    const firstMessages = createMessageReader(firstSocket);
    await waitForOpen(firstSocket);
    await firstMessages.next("server.hello");
    firstSocket.send(replayedAttach);
    await nextEnvelopeMessage(firstMessages, "auth.token");
    await closeSocket(firstSocket);

    const secondSocket = new WebSocket(relayUrl);
    const secondMessages = createMessageReader(secondSocket);
    await waitForOpen(secondSocket);
    await secondMessages.next("server.hello");
    secondSocket.send(replayedAttach);

    const error = await nextEnvelopeMessage(secondMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "relay",
      session_id: null,
      code: "AUTH_INVALID",
      message: "Envelope replay detected",
    });

    await closeSocket(secondSocket);
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

  it("times out encrypted fs.file requests when daemon stays silent", async () => {
    const { app, services } = await buildServer({
      relayPendingRequestTimeoutMs: 80,
    });
    const daemonIdentity = createDaemonIdentity();
    const appIdentity = createAppIdentity();
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-fs-file-timeout-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "FsFile Timeout App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await services.persistState();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const daemonSocket = new WebSocket(relayUrl);
    const daemonMessages = createMessageReader(daemonSocket);
    await waitForOpen(daemonSocket);
    await daemonMessages.next("server.hello");
    sendDaemonHello(daemonSocket, daemonIdentity, {
      deviceId: daemonDevice.device_id,
    });
    await waitFor(
      () => services.presence.get(daemonDevice.device_id)?.online === true,
    );

    services.sessionRegistry.register(
      "session-fs-file-timeout-1",
      appDevice.deviceId,
      daemonDevice.device_id,
      true,
    );

    const appSocket = new WebSocket(relayUrl);
    const appMessages = createMessageReader(appSocket);
    await waitForOpen(appSocket);
    await appMessages.next("server.hello");
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-fs-file-timeout-1",
    });
    await nextEnvelopeMessage(appMessages, "auth.token");
    await nextEnvelopeMessage(appMessages, "device.status");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "fs-file-timeout-1",
          type: "fs.file.req",
          payload: {
            session_id: "session-fs-file-timeout-1",
            file_path: "README.md",
            chunk_index: 0,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "session-fs-file-timeout-1",
          requestId: "fs-file-timeout-1",
          messageType: "fs.file.req",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-fs-file-timeout-x25519",
          ciphertext: "ZW5jcnlwdGVkLWZzLWZpbGUtdGltZW91dA",
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const forwarded = await nextRawEnvelope(
      daemonMessages,
      (envelope) =>
        envelope.message_type === "fs.file.req" &&
        envelope.request_id === "fs-file-timeout-1",
    );
    expect(forwarded).toMatchObject({
      message_type: "fs.file.req",
      cipher_mode: "noise_static_v1",
      request_id: "fs-file-timeout-1",
      session_id: "session-fs-file-timeout-1",
    });

    const error = await nextEnvelopeMessage(appMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "fs-file-timeout-1",
      session_id: "session-fs-file-timeout-1",
      code: "SESSION_NOT_FOUND",
      message: "Target daemon timed out before responding",
    });

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "fs-file-timeout-1",
          type: "fs.file",
          payload: {
            session_id: "session-fs-file-timeout-1",
            file_path: "README.md",
            status: "ready",
            mime_type: "text/markdown",
            chunk_index: 0,
            total_chunks: 1,
            data: "bGF0ZS1maWxlLWNodW5r",
            total_size: 15,
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "session-fs-file-timeout-1",
          requestId: "fs-file-timeout-1",
          messageType: "fs.file",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-fs-file-timeout-x25519",
          ciphertext: "bGF0ZS1mcy1maWxlLXJlc3BvbnNl",
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await expect(
      Promise.race([
        nextEnvelopeMessage(appMessages, "fs.file"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120)),
      ]),
    ).resolves.toBeNull();

    await closeSocket(appSocket);
    await closeSocket(daemonSocket);
    await app.close();
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
    const appIdentity = createAppIdentity();

    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "app-replay-missing-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
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
    sendAuthAttach(appSocket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-replay-missing-1",
    });
    await nextEnvelopeMessage(appMessages, "auth.token");

    appSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-resume-missing-1",
          type: "session.resume",
          payload: {
            session_id: "missing-session",
            last_seq: 9,
          },
        },
        {
          from: appDevice.deviceId,
          sessionId: "missing-session",
          requestId: "session-resume-missing-1",
          messageType: "session.resume",
          cipherMode: "noise_static_v1",
          routingPayload: {
            session_id: "missing-session",
            last_seq: 9,
          },
          signingKey: appIdentity.privateKey,
        },
      ),
    );

    const replayDone = await nextEnvelopeMessage(appMessages, "replay.done");
    expect(replayDone.message.payload).toEqual({
      session_id: "missing-session",
      replayed_count: 0,
      current_seq: 9,
      status: "session_not_found",
      message: "Session not found for replay",
    });

    await closeSocket(appSocket);
    await app.close();
  });

  it("rejects daemon-originated replay.done relay messages", async () => {
    const { app, services } = await buildServer();
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
          id: "daemon-hello-replay-origin-1",
          type: "daemon.hello",
          payload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["pty"],
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: TransportControlSessionId,
          requestId: "daemon-hello-replay-origin-1",
          messageType: "daemon.hello",
          cipherMode: "noise_static_v1",
          routingPayload: {
            device_id: daemonDevice.device_id,
            daemon_version: "0.1.0",
            supported_features: ["pty"],
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    await waitFor(() => services.relayRegistry.getDaemon(daemonDevice.device_id) !== null);

    daemonSocket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "replay-done-daemon-origin-1",
          type: "replay.done",
          payload: {
            session_id: "sess-daemon-origin-1",
            replayed_count: 0,
            current_seq: 0,
            status: "ok",
            message: "Replay complete",
          },
        },
        {
          from: daemonDevice.device_id,
          sessionId: "sess-daemon-origin-1",
          requestId: "replay-done-daemon-origin-1",
          messageType: "replay.done",
          cipherMode: "noise_static_v1",
          routingPayload: {
            session_id: "sess-daemon-origin-1",
            replayed_count: 0,
            current_seq: 0,
            status: "ok",
            message: "Replay complete",
          },
          signingKey: daemonIdentity.privateKey,
        },
      ),
    );

    const error = await nextEnvelopeMessage(daemonMessages, "error");
    expect(error.message.payload).toEqual({
      request_id: "replay-done-daemon-origin-1",
      session_id: "sess-daemon-origin-1",
      code: "PROTOCOL_VERSION",
      message: "replay.done is server-generated and cannot originate from daemon",
    });

    await closeSocket(daemonSocket);
    await app.close();
  });

  it("rejects legacy raw session.resume from an unauthenticated socket", async () => {
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
    expect(error.payload.code).toBe("PROTOCOL_VERSION");
    expect(error.payload.message).toBe(
      "Legacy raw relay messages are no longer allowed for session.resume",
    );

    await closeSocket(socket);
    await app.close();
  });

  it("rejects legacy plain auth.attach envelopes without outer metadata", async () => {
    const { app, services } = await buildServer();
    const appIdentity = createAppIdentity();
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: "daemon-unused",
      appPubKey: "legacy-auth-attach-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Legacy Auth Attach App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const socket = new WebSocket(relayUrl);
    const messages = createMessageReader(socket);
    await waitForOpen(socket);
    await messages.next("server.hello");

    socket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-legacy-envelope-1",
          type: "auth.attach",
          payload: {
            jwt: jwt.jwt,
          },
        },
        {
          from: appDevice.deviceId,
          signingKey: appIdentity.privateKey,
          sessionId: TransportControlSessionId,
          requestId: "auth-attach-legacy-envelope-1",
          legacyOmitOuterMetadata: true,
        },
      ),
    );

    const error = await nextEnvelopeMessage(messages, "error");
    expect(error.message.payload.code).toBe("PROTOCOL_VERSION");
    expect(error.message.payload.message).toBe(
      "Legacy plain envelopes without outer metadata are no longer allowed for auth.attach",
    );

    await closeSocket(socket);
    await app.close();
  });

  it("rejects envelopes signed without routing_payload in the signing payload", async () => {
    const { app, services } = await buildServer();
    const appIdentity = createAppIdentity();
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: "daemon-unused",
      appPubKey: "legacy-signature-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Legacy Signature App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const socket = new WebSocket(relayUrl);
    const messages = createMessageReader(socket);
    await waitForOpen(socket);
    await messages.next("server.hello");

    socket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-legacy-signature-1",
          type: "auth.attach",
          payload: {
            jwt: jwt.jwt,
          },
        },
        {
          from: appDevice.deviceId,
          signingKey: appIdentity.privateKey,
          sessionId: TransportControlSessionId,
          requestId: "auth-attach-legacy-signature-1",
          legacySigningPayload: true,
        },
      ),
    );

    const error = await nextEnvelopeMessage(messages, "error");
    expect(error.message.payload.code).toBe("AUTH_INVALID");
    expect(error.message.payload.message).toBe("Invalid envelope signature");

    await closeSocket(socket);
    await app.close();
  });

  it("rejects encrypted session.start envelopes without sender_pubkey", async () => {
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
    const appDevice = services.deviceRegistry.registerAppDevice({
      linkedDaemonId: daemonDevice.device_id,
      appPubKey: "missing-sender-app-pub",
      appEd25519PubKey: appIdentity.publicKeyBase64Url,
      appDeviceName: "Missing Sender App",
    });
    const jwt = await services.jwtManager.issue(appDevice.deviceId);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/relay`;

    const socket = new WebSocket(relayUrl);
    const messages = createMessageReader(socket);
    await waitForOpen(socket);
    await messages.next("server.hello");

    sendAuthAttach(socket, appIdentity, {
      deviceId: appDevice.deviceId,
      jwt: jwt.jwt,
      id: "auth-attach-missing-sender-1",
    });
    await nextEnvelopeMessage(messages, "auth.token");

    socket.send(
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-missing-sender-1",
          type: "session.start",
          payload: {
            session_id: "session-start-missing-sender-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          from: appDevice.deviceId,
          signingKey: appIdentity.privateKey,
          sessionId: "session-start-missing-sender-1",
          requestId: "session-start-missing-sender-1",
          messageType: "session.start",
          cipherMode: "noise_static_v1",
          ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
          routingPayload: {
            session_id: "session-start-missing-sender-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
      ),
    );

    const error = await nextEnvelopeMessage(messages, "error");
    expect(error.message.payload).toEqual({
      request_id: "session-start-missing-sender-1",
      session_id: "session-start-missing-sender-1",
      code: "PROTOCOL_VERSION",
      message: "Encrypted session.start requires sender_pubkey",
    });

    await closeSocket(socket);
    await app.close();
  });
});
