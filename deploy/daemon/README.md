# HelloBug Daemon

This archive runs the HelloBug daemon on the computer that contains your workspaces and coding-agent CLI. It is not a standalone executable: first start installs platform-specific production dependencies, including `node-pty`.

## Requirements

- Node.js 20 or newer and npm.
- A supported coding-agent CLI, such as Claude Code or Codex.
- A daemon bootstrap token from the HelloBug relay server on first registration only.

## Start

```bash
tar xzf hellobug-daemon-<version>.tar.gz
cd hellobug-daemon-<version>

HELLOBUG_DAEMON_SERVER_URL=wss://relay.example.com/v1/relay \
HELLOBUG_DAEMON_BOOTSTRAP_TOKEN=<bootstrap-token> \
HELLOBUG_DAEMON_ALLOWED_PATHS="/absolute/path/to/workspace" \
./start.sh
```

The daemon prints a pairing code and QR payload. Pair the mobile app with either value, then compare the SAS on both devices before confirming.

After the first successful registration, the daemon saves its credentials locally. Omit `HELLOBUG_DAEMON_BOOTSTRAP_TOKEN` on later starts. Limit `HELLOBUG_DAEMON_ALLOWED_PATHS` to the directories you intend to control.
