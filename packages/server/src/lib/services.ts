import { randomBytes } from "node:crypto";

import { BootstrapTokenRegistry } from "../auth/bootstrap-tokens.js";
import { CertificateAuthority } from "../auth/cert.js";
import { DeviceRegistry } from "../auth/device-registry.js";
import { JwtManager } from "../auth/jwt.js";
import { PairingService } from "../auth/pairing.js";
import { RelayReplayBuffer } from "../relay/buffer.js";
import { RelayRegistry } from "../relay/registry.js";
import { RelaySessionRegistry } from "../relay/sessions.js";
import { PresenceService } from "../state/presence.js";

export interface ServerServices {
  bootstrapTokens: BootstrapTokenRegistry;
  certificateAuthority: CertificateAuthority;
  deviceRegistry: DeviceRegistry;
  jwtManager: JwtManager;
  pairing: PairingService;
  relayRegistry: RelayRegistry;
  replayBuffer: RelayReplayBuffer;
  sessionRegistry: RelaySessionRegistry;
  presence: PresenceService;
}

export async function createServerServices(jwtSecret?: string): Promise<ServerServices> {
  return {
    bootstrapTokens: new BootstrapTokenRegistry(),
    certificateAuthority: await CertificateAuthority.create(),
    deviceRegistry: new DeviceRegistry(),
    jwtManager: new JwtManager(jwtSecret ?? randomBytes(32).toString("base64url")),
    pairing: new PairingService(),
    relayRegistry: new RelayRegistry(),
    replayBuffer: new RelayReplayBuffer(),
    sessionRegistry: new RelaySessionRegistry(),
    presence: new PresenceService(),
  };
}
