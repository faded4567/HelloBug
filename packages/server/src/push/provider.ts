import type { NotificationPushPayload } from "@hellobug/protocol";

export type AndroidPushManufacturer = "Xiaomi" | "OPPO" | "vivo";

export type PushTargetRoute =
  | {
      platform: "ios";
      apnsToken: string;
    }
  | {
      platform: "android";
      manufacturer: AndroidPushManufacturer;
      vendorToken: string;
    };

export interface PushTargetDescriptor {
  appDeviceId: string;
  daemonDeviceId: string;
  route: PushTargetRoute;
}

export type PushProviderResult =
  | {
      status: "accepted";
      provider: string;
      providerMessageId?: string;
    }
  | {
      status: "invalid_token";
      provider: string;
      reason: string;
    }
  | {
      status: "failed";
      provider: string;
      reason: string;
      retryable: boolean;
    };

export interface PushProvider {
  send(
    target: PushTargetDescriptor,
    payload: NotificationPushPayload,
  ): Promise<PushProviderResult>;
}

