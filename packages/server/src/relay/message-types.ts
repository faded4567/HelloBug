import type { Message } from "@hellobug/protocol";

export const AppToDaemonMessageTypes = new Set<string>([
  "session.start",
  "session.agent.add",
  "session.input",
  "session.input.image",
  "session.input.voice_text",
  "session.command.slash",
  "session.cancel",
  "danger.allow",
  "danger.deny",
  "fs.tree.req",
  "fs.file.req",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "pty.resize",
  "key.ratchet",
  "key.ratchet_ack",
]);

export const DaemonBroadcastMessageTypes = new Set<string>([
  "fs.tree",
  "fs.file",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "error",
  "key.ratchet",
  "key.ratchet_ack",
]);

export function getSessionId(message: Message): string | null {
  if (
    typeof message.payload === "object" &&
    message.payload !== null &&
    "session_id" in message.payload &&
    typeof message.payload.session_id === "string"
  ) {
    return message.payload.session_id;
  }

  return null;
}
