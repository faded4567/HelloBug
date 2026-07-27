# HelloBug Relay Server Deployment

This archive deploys the **relay server only**. Run the daemon separately from a complete HelloBug checkout on the computer that contains the workspaces and coding-agent CLI. Do not copy a daemon onto the relay host unless that host is intentionally allowed to execute agent work.

## Prerequisites

- Linux host with Node.js 20 or newer, npm, `openssl`, and `curl`.
- TCP port 3000 reachable from the reverse proxy or trusted clients.
- A domain name and TLS reverse proxy for Internet access.

## 1. Extract the Bundle

```bash
tar xzf hellobug-server.tar.gz
mv server hellobug-server
cd hellobug-server
```

The first start installs production dependencies and starts `packages/server/dist/index.js` in the background.

## 2. Set Server Secrets

Generate two separate values:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Edit `start.sh` and replace `ADMIN_TOKEN` and `JWT_SECRET` with those values. `JWT_SECRET` must remain stable across restarts, otherwise previously issued sessions become invalid. Never commit the edited script or expose either value in shell history, issue trackers, or chat logs.

The first start creates `state.json` beside `start.sh`. It contains server state and cryptographic material; persist it across upgrades and, after the first start, restrict it to the service account:

```bash
chmod 600 state.json
```

## 3. Start and Operate the Server

```bash
./start.sh          # first start installs dependencies; later starts reuse them
./start.sh stop     # stop
./start.sh log      # follow logs
./start.sh token    # issue a five-minute daemon bootstrap token
./start.sh restart  # restart
```

Copy the token from `./start.sh token` to the daemon machine through a secure channel. It is only needed for first-time daemon registration.

## 4. Run the Daemon on the Workspace Machine

On the computer whose projects you intend to control, clone the complete repository and install dependencies:

```bash
git clone https://github.com/faded4567/HelloBug.git
cd HelloBug
npm install -g pnpm@10.12.1
pnpm -C packages install
pnpm -C packages build:daemon
```

Start the daemon with the public relay address, the bootstrap token, and only the required workspace directories:

```bash
HELLOBUG_DAEMON_SERVER_URL=wss://relay.example.com/v1/relay \
HELLOBUG_DAEMON_BOOTSTRAP_TOKEN=<token-from-server> \
HELLOBUG_DAEMON_ALLOWED_PATHS="/absolute/path/to/workspace" \
node packages/daemon/dist/index.js
```

The daemon prints a six-digit pairing code and QR payload. It stores its credentials locally after registration, so omit `HELLOBUG_DAEMON_BOOTSTRAP_TOKEN` on later starts. Ensure the target coding-agent CLI is installed and available on this machine.

## 5. Pair the Mobile App

Open the app, complete onboarding, then enter `wss://relay.example.com/v1/relay` and either scan the daemon's QR payload or enter its pairing code. Confirm that the SAS shown on the app and daemon matches before accepting the pairing.

## 6. TLS Reverse Proxy

For an Internet-accessible relay, terminate TLS and use `wss://` in both app and daemon. Example Nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /v1/relay {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }
}
```

Do not expose an unauthenticated plain-WebSocket relay to the Internet. Restrict firewall access to port 3000 to the reverse proxy where possible.
