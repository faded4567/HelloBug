# Codex Current

Updated: 2026-06-23

## Role

Codex 负责：

- `packages/protocol`、`packages/server`、`packages/daemon`
- server / daemon / protocol 的实现、测试、部署与联调总控
- 与 Flutter 的跨端协议收口、fixture、恢复语义与后端能力输出

Claude 负责整个 `app/` Flutter 客户端，Codex 不再作为 Flutter 主开发负责人。

## Start Order

1. `docs/app-remaining-work.md`：唯一任务状态真源
2. `memory/shared/current-status.md`：跨端现状与关键现实约束
3. `memory/shared/protocol-decisions.md`：涉及协议/安全边界时再读
4. 最后只打开当前任务相关的 `packages/**` 或 `app/lib/**` 逻辑文件

## Current Backend Priorities

- 统一 server / daemon 到真实 `Envelope` 主链路，并与 Claude 对齐 app 侧契约
- 完成真实签名、验签、`seq`、错误处理与跨端 Noise IK fixture
- 补齐 daemon 能力：`fs.tree.req`、`fs.file.req`、`history.list/get`、`templates.list`、`slash.list`、`pty`、`pty.resize`
- 补 server / daemon 业务缺口：设备重命名/吊销、push backend、history、workspace、relay 安全边界
- 为 Claude 提供稳定的 app 对接面：`danger.pending`、`fs.file.req`、push token、replay、workspace、PTY、templates、slash

## Current Runtime Reality

- server 已能桥接 app 侧 `Envelope`，但仍是开发态解包/回包，不是最终 E2EE relay。
- daemon 传输层仍以 plain `Message` 为主。
- app 侧 `noise_ik.dart` 与 `session_cipher.dart` 仍是 stub。
