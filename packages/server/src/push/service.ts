import type { NotificationPushPayload } from "@hellobug/protocol";

import type { AppDeviceRecord, DeviceRegistry } from "../auth/device-registry.js";
import type { RelayRegistry } from "../relay/registry.js";
import type {
  PushProvider,
  PushProviderResult,
  PushTargetDescriptor,
  PushTargetRoute,
} from "./provider.js";

export interface PushDispatchRecord {
  appDeviceId: string;
  daemonDeviceId: string;
  payload: NotificationPushPayload;
  dispatchedAt: number;
  route: PushTargetRoute;
  result: PushProviderResult;
}

export class PushService {
  private readonly dispatches: PushDispatchRecord[] = [];

  constructor(
    private readonly deviceRegistry: DeviceRegistry,
    private readonly relayRegistry: RelayRegistry,
    private readonly provider: PushProvider,
    private readonly onPushTokenInvalidated?: (appDeviceId: string) => Promise<void> | void,
  ) {}

  async dispatchToLinkedOfflineApps(
    daemonDeviceId: string,
    payload: NotificationPushPayload,
  ): Promise<PushDispatchRecord[]> {
    const dispatched: PushDispatchRecord[] = [];

    for (const app of this.listLinkedPushableApps(daemonDeviceId)) {
      if (this.relayRegistry.getAppSockets(app.deviceId).length > 0) {
        continue;
      }

      let result: PushProviderResult;
      try {
        result = await this.provider.send(
          {
            appDeviceId: app.deviceId,
            daemonDeviceId,
            route: app.route,
          },
          payload,
        );
      } catch (error) {
        result = {
          status: "failed",
          provider: "provider_error",
          reason: error instanceof Error ? error.message : "Unknown push provider failure",
          retryable: true,
        };
      }

      const record: PushDispatchRecord = {
        appDeviceId: app.deviceId,
        daemonDeviceId,
        payload,
        dispatchedAt: Date.now(),
        route: structuredClone(app.route),
        result: structuredClone(result),
      };
      this.dispatches.push(record);
      dispatched.push(record);

      if (result.status === "invalid_token") {
        this.deviceRegistry.clearAppPushToken(app.deviceId);
        await this.onPushTokenInvalidated?.(app.deviceId);
      }
    }

    return dispatched;
  }

  listDispatches(): PushDispatchRecord[] {
    return this.dispatches.map((record) => ({
      ...record,
      payload: structuredClone(record.payload),
      route: structuredClone(record.route),
      result: structuredClone(record.result),
    }));
  }

  clear(): void {
    this.dispatches.length = 0;
  }

  private listLinkedPushableApps(daemonDeviceId: string): Array<
    AppDeviceRecord & { route: PushTargetRoute }
  > {
    return this.deviceRegistry
      .listAppDevices()
      .flatMap((app) => {
        if (app.linkedDaemonId !== daemonDeviceId || app.revokedAt) {
          return [];
        }

        const route = this.getPushRoute(app);
        if (!route) {
          return [];
        }

        return [{ ...app, route }];
      });
  }

  private getPushRoute(app: AppDeviceRecord): PushTargetDescriptor["route"] | null {
    if (app.pushPlatform === "ios") {
      return typeof app.apnsToken === "string" && app.apnsToken.length > 0
        ? {
            platform: "ios",
            apnsToken: app.apnsToken,
          }
        : null;
    }

    if (
      app.pushPlatform === "android" &&
      typeof app.vendorToken === "string" &&
      app.vendorToken.length > 0 &&
      app.manufacturer &&
      app.manufacturer !== "Other"
    ) {
      return {
        platform: "android",
        manufacturer: app.manufacturer,
        vendorToken: app.vendorToken,
      };
    }

    return null;
  }
}
