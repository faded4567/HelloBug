import type { WebSocket } from "ws";

import type { DeviceRegistry } from "../auth/device-registry.js";

export class RelayRegistry {
  private readonly daemonSockets = new Map<string, WebSocket>();
  private readonly appSockets = new Map<string, Set<WebSocket>>();

  registerDaemon(deviceId: string, socket: WebSocket): void {
    this.daemonSockets.set(deviceId, socket);
  }

  unregisterDaemon(deviceId: string, socket: WebSocket): void {
    const current = this.daemonSockets.get(deviceId);
    if (current === socket) {
      this.daemonSockets.delete(deviceId);
    }
  }

  getDaemon(deviceId: string): WebSocket | undefined {
    return this.daemonSockets.get(deviceId);
  }

  attachApp(deviceId: string, socket: WebSocket): void {
    const sockets = this.appSockets.get(deviceId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.appSockets.set(deviceId, sockets);
  }

  detachApp(deviceId: string, socket: WebSocket): void {
    const sockets = this.appSockets.get(deviceId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.appSockets.delete(deviceId);
    }
  }

  getAppSockets(deviceId: string): WebSocket[] {
    return Array.from(this.appSockets.get(deviceId) ?? []);
  }

  getAppSocketsForDaemon(deviceRegistry: DeviceRegistry, daemonDeviceId: string): WebSocket[] {
    const sockets: WebSocket[] = [];

    for (const [appDeviceId, appSockets] of this.appSockets.entries()) {
      if (deviceRegistry.getAppDevice(appDeviceId)?.linkedDaemonId !== daemonDeviceId) {
        continue;
      }

      sockets.push(...appSockets);
    }

    return sockets;
  }
}
