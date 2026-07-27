# Backend Runbook

> 适用范围：HelloBug 当前 V1 阶段的 `server + daemon` 本地联调、局域网调试与后端回归。

## 1. 目录约定

后端 workspace 根目录是 `packages/`：

```bash
cd /path/to/HelloBug/packages
```

## 2. Server 本地启动

### 2.1 本地调试 relay

```bash
HELLOBUG_BOOTSTRAP_ADMIN_TOKEN=debug-secret \
HELLOBUG_JWT_SECRET=dev-jwt-secret \
HOST=0.0.0.0 \
PORT=3000 \
pnpm dev:server
```

Server 启动后可用这个接口签一次 daemon bootstrap token：

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/admin/bootstrap-token \
  -H 'x-admin-token: debug-secret' \
  -H 'content-type: application/json' \
  -d '{"ttl_ms":300000}'
```

## 3. Daemon 启动

### 3.1 无配置文件直接启动

daemon 现在支持纯环境变量启动，不再强依赖先写 `~/.hellobug/daemon.json`。

```bash
HELLOBUG_DAEMON_SERVER_URL=ws://127.0.0.1:3000/v1/relay \
HELLOBUG_DAEMON_BOOTSTRAP_TOKEN=<bootstrap_token> \
HELLOBUG_DAEMON_ALLOWED_PATHS="/abs/workspace-a:/abs/workspace-b" \
pnpm dev:daemon
```

说明：
- `HELLOBUG_DAEMON_BOOTSTRAP_TOKEN` 只在首次注册、还没有本地证书时需要。
- `HELLOBUG_DAEMON_ALLOWED_PATHS` 默认按系统路径分隔符切分；macOS / Linux 用 `:`
- 也支持 JSON 数组写法：

```bash
HELLOBUG_DAEMON_ALLOWED_PATHS='["/abs/workspace-a","/abs/workspace-b"]'
```

### 3.2 局域网联调

```bash
HELLOBUG_DAEMON_SERVER_URL=ws://192.168.18.8:3000/v1/relay \
HELLOBUG_DAEMON_BOOTSTRAP_TOKEN=<bootstrap_token> \
HELLOBUG_DAEMON_ALLOWED_PATHS="/absolute/path/to/your/workspace" \
pnpm dev:daemon
```

### 3.3 继续使用配置文件

如果仍然想走配置文件：

```json
{
  "server_url": "ws://127.0.0.1:3000/v1/relay",
  "bootstrap_token": "<bootstrap_token>",
  "allowed_paths": ["/abs/workspace-a"]
}
```

默认路径：

```text
~/.hellobug/daemon.json
```

也可以切到自定义路径：

```bash
HELLOBUG_DAEMON_CONFIG_PATH=/abs/path/daemon.json pnpm dev:daemon
```

## 4. 回归命令

### 4.1 Server relay 回归

```bash
pnpm test:server:relay
```

覆盖：
- relay framing
- relay route / replay / timeout
- message type 约束

### 4.2 Daemon V1 回归

```bash
pnpm test:daemon:v1
```

覆盖：
- daemon transport / pairing / session
- history
- workspace / file preview
- file.changed diff

### 4.3 Backend V1 回归

```bash
pnpm test:v1:backend
```

## 5. Build 命令

```bash
pnpm build
pnpm build:server
pnpm build:daemon
```
