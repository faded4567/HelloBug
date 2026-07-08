#!/usr/bin/env bash
# HelloBug Server 一键脚本
# 用法:
#   ./start.sh          启动（自动安装依赖 + 杀旧进程 + 后台常驻）
#   ./start.sh stop     停止
#   ./start.sh log      查看日志
#   ./start.sh token    签发 daemon bootstrap token
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ══════════════════════════════════════════════════════════════
# 配置区 —— 修改这里
# ══════════════════════════════════════════════════════════════

# 管理员密钥（openssl rand -hex 32 生成）
ADMIN_TOKEN="changeme-admin-token"

# JWT 签名密钥（openssl rand -hex 32 生成，重启不能换）
JWT_SECRET="changeme-jwt-secret"

# 监听地址和端口
HOST="0.0.0.0"
PORT="3000"

# 状态持久化文件（可选，不设则用内存）
STATE_FILE="${SCRIPT_DIR}/state.json"

# 日志文件
LOG_FILE="${SCRIPT_DIR}/server.log"

# ══════════════════════════════════════════════════════════════
# 函数
# ══════════════════════════════════════════════════════════════

_stop() {
    echo "🛑 停止已有进程..."

    # 按端口杀
    local pid
    pid=$(lsof -ti ":$PORT" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "   端口 $PORT 被进程 $pid 占用，终止中..."
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
        echo "   已终止"
    fi

    # 兜底按进程名杀
    local matches
    matches=$(pgrep -f "hellobug.*server" 2>/dev/null || true)
    if [ -n "$matches" ]; then
        echo "   清理残留进程: $matches"
        echo "$matches" | xargs kill 2>/dev/null || true
        sleep 1
    fi

    echo ""
}

_install() {
    if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
        echo "📦 依赖已安装，跳过"
        echo ""
        return
    fi

    echo "📦 安装依赖（仅首次需要）..."
    if ! command -v pnpm &>/dev/null; then
        echo "   检测到未安装 pnpm，正在安装..."
        npm install -g pnpm
    fi

    pnpm install --prod
    echo ""
}

_start() {
    export HOST
    export PORT
    export HELLOBUG_BOOTSTRAP_ADMIN_TOKEN="$ADMIN_TOKEN"
    export HELLOBUG_JWT_SECRET="$JWT_SECRET"
    if [ -n "$STATE_FILE" ]; then
        export HELLOBUG_SERVER_STATE_FILE="$STATE_FILE"
    fi

    if [ "$ADMIN_TOKEN" = "changeme-admin-token" ] || [ "$JWT_SECRET" = "changeme-jwt-secret" ]; then
        echo "⚠️  请先编辑 start.sh 修改 ADMIN_TOKEN 和 JWT_SECRET"
        echo "   用 openssl rand -hex 32 各生成一个"
        exit 1
    fi

    echo "🚀 HelloBug Server 启动..."
    echo "   HOST=$HOST  PORT=$PORT  LOG=$LOG_FILE"
    echo ""

    nohup node packages/server/dist/index.js >> "$LOG_FILE" 2>&1 &
    local pid=$!

    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "✅ Server 已启动 (PID=$pid)"
        echo ""
        echo "   查看日志:   ./start.sh log"
        echo "   签发 token: ./start.sh token"
        echo "   停止服务:   ./start.sh stop"
    else
        echo "❌ 启动失败，日志:"
        tail -20 "$LOG_FILE"
        exit 1
    fi
}

_log() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "日志文件 $LOG_FILE 不存在"
        exit 1
    fi
}

_token() {
    echo "签发 daemon bootstrap token..."
    curl -sS -X POST "http://127.0.0.1:$PORT/v1/admin/bootstrap-token" \
        -H "x-admin-token: $ADMIN_TOKEN" \
        -H "content-type: application/json" \
        -d '{"ttl_ms":300000}' \
        | python3 -m json.tool 2>/dev/null || \
    curl -sS -X POST "http://127.0.0.1:$PORT/v1/admin/bootstrap-token" \
        -H "x-admin-token: $ADMIN_TOKEN" \
        -H "content-type: application/json" \
        -d '{"ttl_ms":300000}'
    echo ""
}

# ══════════════════════════════════════════════════════════════
# 子命令
# ══════════════════════════════════════════════════════════════

CMD="${1:-start}"

case "$CMD" in
stop)
    _stop
    ;;
log)
    _log
    ;;
token)
    _token
    ;;
start|restart)
    _stop
    _install
    _start
    ;;
*)
    echo "用法: ./start.sh [start|stop|log|token]"
    exit 1
    ;;
esac
