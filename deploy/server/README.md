# HelloBug Server 部署

## 1. 上传到服务器

```bash
tar xzf hellobug-server.tar.gz
mv server hellobug-server && cd hellobug-server
```

## 2. 编辑配置

```bash
vi start.sh
```

修改顶部的 `ADMIN_TOKEN` 和 `JWT_SECRET`（用 `openssl rand -hex 32` 生成）。

## 3. 一个脚本搞定所有

```bash
./start.sh          # 首次：装依赖 → 杀旧进程 → 后台启动
                    # 后续：杀旧进程 → 启动（秒起）

./start.sh stop     # 停止服务
./start.sh log      # 实时日志
./start.sh token    # 签发 daemon bootstrap token
./start.sh restart  # 等同于 start
```

## 4. 拿到 token 后启动 daemon

```bash
HELLOBUG_DAEMON_SERVER_URL=ws://<server_ip>:3000/v1/relay \
HELLOBUG_DAEMON_BOOTSTRAP_TOKEN=<上一步返回的token> \
HELLOBUG_DAEMON_ALLOWED_PATHS="/your/project" \
node packages/daemon/dist/index.js
```

首次需要 bootstrap_token，之后 daemon 本地缓存证书，不再需要。

## 5. 反向代理（可选）

```nginx
server {
    listen 443 ssl;
    server_name relay.yourdomain.com;

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

客户端连接地址：`wss://relay.yourdomain.com/v1/relay`
