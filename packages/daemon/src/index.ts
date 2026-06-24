import { EncryptedAuditLogger } from "./audit/logger.js";
import { createAgentRuntimeFactory } from "./agents/factory.js";
import { DaemonCatalogService } from "./catalog/service.js";
import { loadDaemonConfig } from "./config/load.js";
import { resolveRegisterUrl } from "./config/schema.js";
import { DeviceKeyStore } from "./crypto/keys.js";
import { DaemonWorkspaceService } from "./fs/workspace.js";
import { DangerApprovalInterceptor } from "./guard/interceptor.js";
import { loadDangerRuleSet } from "./guard/rules.js";
import { DaemonTranscriptService } from "./history/transcripts.js";
import { PairingSlotManager } from "./pairing/code.js";
import { DaemonSessionManager } from "./sessions/manager.js";
import { DaemonConnection } from "./transport/connection.js";
import { createDaemonMessageRouter } from "./transport/message-router.js";
import { CertificateStore, registerDaemon } from "./transport/register.js";

export async function bootstrapDaemon(): Promise<{
  connection: DaemonConnection;
  pairingSlotManager: PairingSlotManager;
  announcePairingSlot: () => void;
}> {
  const config = await loadDaemonConfig();
  const identity = await new DeviceKeyStore().loadOrCreate();
  const certificateStore = new CertificateStore();

  let certificates = await certificateStore.load();
  if (!certificates) {
    if (!config.bootstrap_token) {
      throw new Error("bootstrap_token is required for first-time daemon registration");
    }
    certificates = await registerDaemon({
      registerUrl: resolveRegisterUrl(config),
      bootstrapToken: config.bootstrap_token,
      devicePubKey: identity.ed25519PublicKeyBase64Url,
    });
    await certificateStore.save(certificates);
  }

  const pairingSlotManager = new PairingSlotManager();
  const auditLogger = new EncryptedAuditLogger(identity);
  const dangerRules = await loadDangerRuleSet();
  let sendMessage: ((message: Parameters<DaemonConnection["sendMessage"]>[0]) => void) | null = null;
  const dangerInterceptor = new DangerApprovalInterceptor({
    sendMessage: (message) => {
      if (!sendMessage) {
        throw new Error("daemon connection is not ready");
      }
      sendMessage(message);
    },
    rules: dangerRules,
    auditLogger,
  });
  const sessionManager = new DaemonSessionManager({
    sendMessage: (message) => {
      if (!sendMessage) {
        throw new Error("daemon connection is not ready");
      }
      sendMessage(message);
    },
    allowedPaths: config.allowed_paths,
    runtimeFactory: createAgentRuntimeFactory(),
    auditLogger,
    dangerInterceptor,
  });
  const workspaceService = new DaemonWorkspaceService({
    allowedPaths: config.allowed_paths,
    sessions: sessionManager,
  });
  const transcriptService = new DaemonTranscriptService({
    allowedPaths: config.allowed_paths,
  });
  const catalogService = new DaemonCatalogService({
    sessions: sessionManager,
  });
  const connection = new DaemonConnection({
    serverUrl: config.server_url,
    identity,
    certificates,
    handlers: {
      onMessage: createDaemonMessageRouter({
        identity,
        sessions: sessionManager,
        workspace: workspaceService,
        history: transcriptService,
        catalog: catalogService,
        onPairingConfirmed: announcePairingSlot,
      }),
    },
  });
  function announcePairingSlot(): void {
    pairingSlotManager.pruneExpired();
    const slot = pairingSlotManager.issuePairingSlot(
      config.pairing_ttl_ms ?? 30_000,
    );
    connection.announcePairingSlot(slot);
    logPairingSlot(config.server_url, slot);
  }
  sendMessage = (message) => {
    connection.sendMessage(message);
  };

  return { connection, pairingSlotManager, announcePairingSlot };
}

async function main(): Promise<void> {
  const { connection, announcePairingSlot } = await bootstrapDaemon();
  await connection.connect();
  announcePairingSlot();
  const timer = setInterval(
    announcePairingSlot,
    configRefreshInterval(await loadDaemonConfig()),
  );
  timer.unref();
}

function configRefreshInterval(config: Awaited<ReturnType<typeof loadDaemonConfig>>): number {
  return config.pairing_refresh_ms ?? 25_000;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

function logPairingSlot(
  serverUrl: string,
  slot: {
    pairing_code: string;
    expires_at: number;
  },
): void {
  const payload = JSON.stringify({
    pairing_code: slot.pairing_code,
    server_url: serverUrl,
  });

  console.log(`[pairing] code: ${slot.pairing_code} (expires ${new Date(slot.expires_at).toISOString()})`);
  console.log(`[pairing] server: ${serverUrl}`);
  console.log(`[pairing] qr-payload: ${payload}`);
}
