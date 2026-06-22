import type { WebSocket } from "ws";

export interface PairingReadyRecord {
  pairingId: string;
  pairingCode: string;
  expiresAt: number;
  daemonDeviceId: string;
  registeredAt: number;
}

export interface PairingAttempt {
  pairingId: string;
  pairingCode: string;
  daemonDeviceId: string;
  appSocket: WebSocket;
  appPubKey: string;
  appEd25519PubKey: string;
  appDeviceName: string;
  serverUrl?: string;
  startedAt: number;
}

export class PairingService {
  private readonly readySlots = new Map<string, PairingReadyRecord>();
  private readonly attemptsByDaemon = new Map<string, PairingAttempt>();
  private readonly attemptsByAppSocket = new Map<WebSocket, PairingAttempt>();

  registerReady(
    daemonDeviceId: string,
    slot: { pairing_id: string; pairing_code: string; expires_at: number },
  ): PairingReadyRecord {
    this.pruneExpired();

    const record: PairingReadyRecord = {
      pairingId: slot.pairing_id,
      pairingCode: slot.pairing_code,
      expiresAt: slot.expires_at,
      daemonDeviceId,
      registeredAt: Date.now(),
    };

    this.readySlots.set(record.pairingId, record);
    return record;
  }

  startAttempt(input: {
    appSocket: WebSocket;
    pairingCode: string;
    appPubKey: string;
    appEd25519PubKey: string;
    appDeviceName: string;
    serverUrl?: string;
  }): PairingAttempt | null {
    this.pruneExpired();

    const slot = this.findReadyByCode(input.pairingCode);
    if (!slot) {
      return null;
    }

    this.readySlots.delete(slot.pairingId);

    const previousDaemonAttempt = this.attemptsByDaemon.get(slot.daemonDeviceId);
    if (previousDaemonAttempt) {
      this.attemptsByAppSocket.delete(previousDaemonAttempt.appSocket);
    }

    const previousSocketAttempt = this.attemptsByAppSocket.get(input.appSocket);
    if (previousSocketAttempt) {
      this.attemptsByDaemon.delete(previousSocketAttempt.daemonDeviceId);
    }

    const attempt: PairingAttempt = {
      pairingId: slot.pairingId,
      pairingCode: slot.pairingCode,
      daemonDeviceId: slot.daemonDeviceId,
      appSocket: input.appSocket,
      appPubKey: input.appPubKey,
      appEd25519PubKey: input.appEd25519PubKey,
      appDeviceName: input.appDeviceName,
      serverUrl: input.serverUrl,
      startedAt: Date.now(),
    };

    this.attemptsByDaemon.set(attempt.daemonDeviceId, attempt);
    this.attemptsByAppSocket.set(attempt.appSocket, attempt);
    return attempt;
  }

  getAttemptByDaemonDeviceId(daemonDeviceId: string): PairingAttempt | undefined {
    this.pruneExpired();
    return this.attemptsByDaemon.get(daemonDeviceId);
  }

  getAttemptByAppSocket(appSocket: WebSocket): PairingAttempt | undefined {
    this.pruneExpired();
    return this.attemptsByAppSocket.get(appSocket);
  }

  completeAttemptForAppSocket(appSocket: WebSocket): PairingAttempt | null {
    const attempt = this.attemptsByAppSocket.get(appSocket);
    if (!attempt) {
      return null;
    }

    this.attemptsByAppSocket.delete(appSocket);
    this.attemptsByDaemon.delete(attempt.daemonDeviceId);
    return attempt;
  }

  clearAppSocket(appSocket: WebSocket): void {
    const attempt = this.attemptsByAppSocket.get(appSocket);
    if (!attempt) {
      return;
    }

    this.attemptsByAppSocket.delete(appSocket);
    this.attemptsByDaemon.delete(attempt.daemonDeviceId);
  }

  clearDaemon(daemonDeviceId: string): void {
    for (const [pairingId, slot] of this.readySlots.entries()) {
      if (slot.daemonDeviceId === daemonDeviceId) {
        this.readySlots.delete(pairingId);
      }
    }

    const attempt = this.attemptsByDaemon.get(daemonDeviceId);
    if (!attempt) {
      return;
    }

    this.attemptsByDaemon.delete(daemonDeviceId);
    this.attemptsByAppSocket.delete(attempt.appSocket);
  }

  pruneExpired(now = Date.now()): void {
    for (const [pairingId, slot] of this.readySlots.entries()) {
      if (slot.expiresAt < now) {
        this.readySlots.delete(pairingId);
      }
    }

    for (const [appSocket, attempt] of this.attemptsByAppSocket.entries()) {
      if (attempt.startedAt + 60_000 < now) {
        this.attemptsByAppSocket.delete(appSocket);
        this.attemptsByDaemon.delete(attempt.daemonDeviceId);
      }
    }
  }

  private findReadyByCode(pairingCode: string): PairingReadyRecord | null {
    for (const slot of this.readySlots.values()) {
      if (slot.pairingCode === pairingCode) {
        return slot;
      }
    }

    return null;
  }
}
