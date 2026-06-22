import { EncryptedAuditLogger } from "./audit/logger.js";
import { createAgentRuntimeFactory } from "./agents/factory.js";
import { loadDaemonConfig } from "./config/load.js";
import { resolveRegisterUrl } from "./config/schema.js";
import { DeviceKeyStore } from "./crypto/keys.js";
import { DangerApprovalInterceptor } from "./guard/interceptor.js";
import { loadDangerRuleSet } from "./guard/rules.js";
import { PairingSlotManager } from "./pairing/code.js";
import { DaemonSessionManager } from "./sessions/manager.js";
import { DaemonConnection } from "./transport/connection.js";
import { createDaemonMessageRouter } from "./transport/message-router.js";
import { CertificateStore, registerDaemon } from "./transport/register.js";

export async function bootstrapDaemon(): Promise<{
  connection: DaemonConnection;
  pairingSlotManager: PairingSlotManager;
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
  const connection = new DaemonConnection({
    serverUrl: config.server_url,
    identity,
    certificates,
    handlers: {
      onMessage: createDaemonMessageRouter({
        identity,
        sessions: sessionManager,
      }),
    },
  });
  sendMessage = (message) => {
    connection.sendMessage(message);
  };

  return { connection, pairingSlotManager };
}

async function main(): Promise<void> {
  const { connection, pairingSlotManager } = await bootstrapDaemon();
  await connection.connect();
  connection.announcePairingSlot(pairingSlotManager.issuePairingSlot());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
