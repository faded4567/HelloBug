# HelloBug

HelloBug 让你通过移动设备发起和跟进本地编码 Agent 会话。Agent 始终运行在你自己的电脑上；移动端 App、中继服务器和 daemon 通过加密会话流量交换信息，让你可以远程查看输出并确认受保护操作。

> **项目状态：** V1 正在积极开发中。当前适合本地开发和受控的自托管测试，不应作为生产服务使用。

## 架构说明

```text
移动端 App <-> 中继服务器 <-> 电脑上的 daemon <-> Claude Code / Codex
```

- `app/`：Flutter 移动端客户端。
- `packages/server/`：WebSocket 中继和 daemon 首次注册服务。
- `packages/daemon/`：运行在有权访问本地工作区的电脑上。
- `deploy/`：仅包含中继服务器的部署包。

中继服务器不会运行编码 Agent。实际执行由 daemon 完成，并且它只能访问 `HELLOBUG_DAEMON_ALLOWED_PATHS` 中明确列出的目录。

## 环境要求

- Node.js 20 或更高版本，以及 npm。
- pnpm 10.12.1：`npm install -g pnpm@10.12.1`。
- Flutter（Dart 3.7 或更高版本），用于构建和运行移动端 App。
- daemon 机器上已安装受支持的编码 Agent CLI，例如 Claude Code 或 Codex。
- `openssl`，用于生成非开发环境的随机密钥。

## 本地快速开始

以下步骤会在同一台电脑上运行 server 和 daemon，需要使用三个终端。

### 1. 安装后端依赖

```bash
pnpm -C packages install
```

### 2. 启动中继服务器

在终端 1 中生成两个临时的本地开发密钥并启动服务：

```bash
export HELLOBUG_BOOTSTRAP_ADMIN_TOKEN="$(openssl rand -hex 32)"
export HELLOBUG_JWT_SECRET="$(openssl rand -hex 32)"
export HOST=0.0.0.0
export PORT=3000

pnpm -C packages dev:server
```

保持此终端运行，并妥善保存 `HELLOBUG_BOOTSTRAP_ADMIN_TOKEN`，下一步需要使用。不要将这些临时值用于可从互联网访问的中继服务。

### 3. 签发一次性 daemon bootstrap token

在终端 2 中填入步骤 2 的管理员 token：

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/admin/bootstrap-token \
  -H 'x-admin-token: <HELLOBUG_BOOTSTRAP_ADMIN_TOKEN>' \
  -H 'content-type: application/json' \
  -d '{"ttl_ms":300000}'
```

从 JSON 响应中复制 `token` 字段。它只在 daemon 首次注册时需要，随后 daemon 会在本地保存客户端凭据。

### 4. 启动 daemon

仍在终端 2 中，将 daemon 的访问范围限制为你需要控制的工作区：

```bash
HELLOBUG_DAEMON_SERVER_URL=ws://127.0.0.1:3000/v1/relay \
HELLOBUG_DAEMON_BOOTSTRAP_TOKEN=<步骤-3-返回的-token> \
HELLOBUG_DAEMON_ALLOWED_PATHS="/你的工作区绝对路径" \
pnpm -C packages dev:daemon
```

daemon 会输出六位配对码和 QR payload。使用 App 期间请保持 daemon 运行。在 macOS 和 Linux 上，多个允许目录用 `:` 分隔；也可以使用 JSON 字符串数组。详细说明见[后端运行手册](docs/backend-runbook.md)。

### 5. 运行并配对移动端 App

在终端 3 中执行：

```bash
cd app
flutter pub get
flutter run
```

首次启动后，完成引导并进入配对页面：

1. 输入 daemon 使用的中继服务器地址。
2. 扫描 daemon 输出的 QR payload，或输入六位配对码。
3. 对比并确认两端展示的 SAS。
4. 在 App 中选择已允许的工作区并发起会话。

Android 模拟器访问本机中继服务时，在 App 内使用 `ws://10.0.2.2:3000/v1/relay`；iOS Simulator 使用 `ws://127.0.0.1:3000/v1/relay`；真机使用开发机可访问的局域网地址。daemon 若运行在服务所在机器上，仍可使用 `ws://127.0.0.1:3000/v1/relay`。

## 自托管中继服务

`deploy/hellobug-server.tar.gz` 只包含中继服务和 protocol 包。将它部署到服务器后，请在拥有工作区和编码 Agent CLI 的电脑上，从完整的 HelloBug 仓库运行 daemon。

面向互联网的中继服务必须通过 TLS 反向代理使用 `wss://`。请妥善保管管理员 token、JWT secret、生成的 server state、bootstrap token 和 daemon 凭据。具体流程见[服务端部署指南](deploy/server/README.md)。

## 开发命令

从仓库根目录执行：

```bash
pnpm -C packages build
pnpm -C packages test
pnpm -C packages lint
pnpm -C packages test:server:relay
pnpm -C packages test:daemon:v1
pnpm -C packages test:v1:backend
```

Flutter 测试：

```bash
cd app
flutter test
```

## 安全说明

- 将 `HELLOBUG_DAEMON_ALLOWED_PATHS` 视为安全边界。除非明确需要，请勿将它设为整个家目录或范围过大的源码目录。
- 不要提交 `.env`、token、证书、`state.json` 或 daemon 运行状态。仓库已忽略运行时 `.hellobug/` 目录，但每次提交前仍应检查 `git status`。
- 直接使用 `ws://` 仅适用于 localhost 或可信局域网；远程访问必须使用 TLS 和 `wss://`。

## 延伸阅读

- [后端本地开发与回归运行手册](docs/backend-runbook.md)
- [服务端部署指南](deploy/server/README.md)
- [GitHub Release 发布指南](docs/releasing.md)
- [协议规范](docs/protocol.md)
- [当前 V1 范围](docs/v1-checklist.md)
