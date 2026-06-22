import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { buildServer } from "../src/app.js";
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
