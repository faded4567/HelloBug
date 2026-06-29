import { describe, expect, it } from "vitest";

import { AppToDaemonMessageTypes, DaemonBroadcastMessageTypes } from "../src/relay/message-types.js";

describe("relay message type registry", () => {
  it("forwards pty.input from app clients to daemons", () => {
    expect(AppToDaemonMessageTypes.has("pty.input")).toBe(true);
  });

  it("forwards workspace discovery requests from app clients to daemons", () => {
    expect(AppToDaemonMessageTypes.has("workspace.list")).toBe(true);
    expect(AppToDaemonMessageTypes.has("workspace.resolve")).toBe(true);
  });

  it("keeps PTY output inside session.event instead of top-level broadcasts", () => {
    expect(DaemonBroadcastMessageTypes.has("pty.data")).toBe(false);
  });
});
