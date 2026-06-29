import type { NotificationPushPayload } from "@hellobug/protocol";

import type {
  PushProvider,
  PushProviderResult,
  PushTargetDescriptor,
} from "./provider.js";

export class NoopPushProvider implements PushProvider {
  async send(
    _target: PushTargetDescriptor,
    _payload: NotificationPushPayload,
  ): Promise<PushProviderResult> {
    return {
      status: "accepted",
      provider: "noop",
    };
  }
}
