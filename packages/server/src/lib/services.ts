import { randomBytes } from "node:crypto";

import { BootstrapTokenRegistry } from "../auth/bootstrap-tokens.js";
import { CertificateAuthority } from "../auth/cert.js";
import { DeviceRegistry } from "../auth/device-registry.js";
import { JwtManager } from "../auth/jwt.js";
import { PairingService } from "../auth/pairing.js";
import { RelayReplayBuffer } from "../relay/buffer.js";
import { RelayPendingDangerRegistry } from "../relay/pending-danger.js";
import { RelayEnvelopeReplayRegistry } from "../relay/envelope-replay.js";
import { RelayRequestRegistry } from "../relay/requests.js";
import { RelayRegistry } from "../relay/registry.js";
import { RelaySessionRegistry } from "../relay/sessions.js";
import { NoopPushProvider } from "../push/noop-provider.js";
import type { PushProvider } from "../push/provider.js";
import { PushService } from "../push/service.js";
import { PresenceService } from "../state/presence.js";
import { ServerStateStore } from "./state-store.js";

const DefaultPendingRequestTimeoutMs = 5_000;
const DefaultPendingSessionStartTimeoutMs = 12_000;

export interface ServerServices {
  bootstrapTokens: BootstrapTokenRegistry;
  certificateAuthority: CertificateAuthority;
  deviceRegistry: DeviceRegistry;
  jwtManager: JwtManager;
  pairing: PairingService;
  relayRegistry: RelayRegistry;
  replayBuffer: RelayReplayBuffer;
  envelopeReplays: RelayEnvelopeReplayRegistry;
  pendingDangers: RelayPendingDangerRegistry;
  requestRegistry: RelayRequestRegistry;
  sessionRegistry: RelaySessionRegistry;
  push: PushService;
  presence: PresenceService;
  persistState: () => Promise<void>;
}

export interface CreateServerServicesOptions {
  jwtSecret?: string;
  stateStore?: ServerStateStore;
  relayPendingRequestTimeoutMs?: number;
  relayPendingSessionStartTimeoutMs?: number;
  pushProvider?: PushProvider;
}

export async function createServerServices(
  options: CreateServerServicesOptions = {},
): Promise<ServerServices> {
  const stateStore = options.stateStore ?? new ServerStateStore();
  const persisted = await stateStore.load();
  const deviceRegistry = new DeviceRegistry(persisted?.devices);
  const relayRegistry = new RelayRegistry();

  const services: ServerServices = {
    bootstrapTokens: new BootstrapTokenRegistry(persisted?.bootstrapTokens),
    certificateAuthority: persisted
      ? CertificateAuthority.fromState(persisted.certificateAuthority)
      : await CertificateAuthority.create(),
    deviceRegistry,
    jwtManager: new JwtManager(
      persisted?.jwtSecret ??
        options.jwtSecret ??
        randomBytes(32).toString("base64url"),
    ),
    pairing: new PairingService(),
    relayRegistry,
    replayBuffer: new RelayReplayBuffer(),
    envelopeReplays: new RelayEnvelopeReplayRegistry(),
    pendingDangers: new RelayPendingDangerRegistry(),
    requestRegistry: new RelayRequestRegistry({
      timeoutMs:
        options.relayPendingRequestTimeoutMs ??
        DefaultPendingRequestTimeoutMs,
    }),
    sessionRegistry: new RelaySessionRegistry({
      pendingStartTimeoutMs:
        options.relayPendingSessionStartTimeoutMs ??
        DefaultPendingSessionStartTimeoutMs,
    }),
    push: new PushService(
      deviceRegistry,
      relayRegistry,
      options.pushProvider ?? new NoopPushProvider(),
      async () => {
        await services.persistState();
      },
    ),
    presence: new PresenceService(),
    persistState: async () => {
      await stateStore.save({
        jwtSecret: services.jwtManager.exportSecret(),
        certificateAuthority: services.certificateAuthority.exportState(),
        devices: services.deviceRegistry.exportState(),
        bootstrapTokens: services.bootstrapTokens.exportState(),
      });
    },
  };

  await services.persistState();
  return services;
}
