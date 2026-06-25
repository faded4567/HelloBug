import { randomBytes } from "node:crypto";

import { BootstrapTokenRegistry } from "../auth/bootstrap-tokens.js";
import { CertificateAuthority } from "../auth/cert.js";
import { DeviceRegistry } from "../auth/device-registry.js";
import { JwtManager } from "../auth/jwt.js";
import { PairingService } from "../auth/pairing.js";
import { RelayReplayBuffer } from "../relay/buffer.js";
import { RelayPendingDangerRegistry } from "../relay/pending-danger.js";
import { RelayRegistry } from "../relay/registry.js";
import { RelaySessionRegistry } from "../relay/sessions.js";
import { PresenceService } from "../state/presence.js";
import { ServerStateStore } from "./state-store.js";

export interface ServerServices {
  bootstrapTokens: BootstrapTokenRegistry;
  certificateAuthority: CertificateAuthority;
  deviceRegistry: DeviceRegistry;
  jwtManager: JwtManager;
  pairing: PairingService;
  relayRegistry: RelayRegistry;
  replayBuffer: RelayReplayBuffer;
  pendingDangers: RelayPendingDangerRegistry;
  sessionRegistry: RelaySessionRegistry;
  presence: PresenceService;
  persistState: () => Promise<void>;
}

export async function createServerServices(
  jwtSecret?: string,
  stateStore = new ServerStateStore(),
): Promise<ServerServices> {
  const persisted = await stateStore.load();

  const services: ServerServices = {
    bootstrapTokens: new BootstrapTokenRegistry(persisted?.bootstrapTokens),
    certificateAuthority: persisted
      ? CertificateAuthority.fromState(persisted.certificateAuthority)
      : await CertificateAuthority.create(),
    deviceRegistry: new DeviceRegistry(persisted?.devices),
    jwtManager: new JwtManager(
      persisted?.jwtSecret ?? jwtSecret ?? randomBytes(32).toString("base64url"),
    ),
    pairing: new PairingService(),
    relayRegistry: new RelayRegistry(),
    replayBuffer: new RelayReplayBuffer(),
    pendingDangers: new RelayPendingDangerRegistry(),
    sessionRegistry: new RelaySessionRegistry(),
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
