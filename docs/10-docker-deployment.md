# 10 · Docker 部署

Docker 镜像同时提供静态网页和课堂同步 API。C 程序仍在浏览器中执行，服务器不编译学生源码。运行时只有 Node.js、`dist/` 和零依赖的同步服务，不需要数据库或数据卷。

> 本文的 Compose 命令用于本地/自行托管的源码构建。`contabo-eu` 的公开镜像手动更新使用独立 image-only 配置，见 [镜像发布与手动部署](10-cicd-deploy.md)；不要在生产服务器执行下方的裸 `docker compose up`。

## 1. 快速启动

需要 Docker Engine / Docker Desktop（Linux 容器模式）和 Docker Compose v2。宿主机不需要安装 Node.js 或 GCC。首次构建需要访问 Docker Hub、Debian 软件源和 npm。

在仓库根目录运行：

```bash
docker compose up -d --build --wait
docker compose ps
docker compose logs -f c-lab
```

本机打开 `http://localhost:8000`。局域网课堂应让老师和学生都打开 `http://<宿主机局域网IP>:8000`，并在宿主机防火墙中放行该端口。

默认将端口发布到全部 IPv4 接口，能否从公网访问还取决于宿主机网络、防火墙和云安全组。不要在未配置访问控制的情况下把课堂服务直接开放给不可信用户。

## 2. 配置端口和课堂加入链接

复制 `.env.example` 为 `.env`（Linux/macOS：`cp .env.example .env`；PowerShell：`Copy-Item .env.example .env`），然后按实际部署修改：

```dotenv
BIND_ADDRESS=0.0.0.0
HTTP_PORT=9000
PUBLIC_ORIGIN=http://192.168.1.100:9000
```

修改后执行 `docker compose up -d --wait`，让 Compose 按新环境重新创建容器。修改源码后还需加 `--build`。

| 配置 | 默认值 | 说明 |
|---|---|---|
| `BIND_ADDRESS` | `0.0.0.0` | 宿主机监听地址；宿主机反向代理场景可设 `127.0.0.1` |
| `HTTP_PORT` | `8000` | 宿主机发布端口；容器内部仍是 `8000` |
| `PUBLIC_ORIGIN` | 空 | 学生可访问的完整 origin，例如 `https://clab.example.com`；仅接受 HTTP(S)，可带端口，不可带用户名、密码、子路径、查询或片段 |

`PUBLIC_ORIGIN` 是**运行时配置**，无需为不同域名重建前端。它仅决定课堂加入链接，不自动设置 DNS、TLS、端口转发、CORS 或登录权限。配置后，老师即使从 localhost 进入，也会得到公网/局域网链接；建议所有人使用同一个 origin。

镜像默认 `DISCOVER_LAN=0`，不会把容器的 `172.x.x.x` 内网地址当成学生访问地址。未设置 `PUBLIC_ORIGIN` 时，分享链接沿用老师浏览器中的 URL；老师不能用 localhost 向其他设备共享。

原生 `npm run serve` 保持 LAN 自动发现。直接运行 Node 时可通过进程环境设置 `PUBLIC_ORIGIN`、`DISCOVER_LAN=0`、`HOST`、`PORT`、`STATIC_ROOT`；它不会自动读取 Compose 的 `.env` 文件。

## 3. 域名和 HTTPS

推荐单独使用 `clab.example.com` 一类子域名，将 DNS 指向 Docker 宿主机，再用 nginx / Caddy 终止 TLS。当前应用的 API 使用 `/api/*`，应部署在域名根路径，而不是 `/lab/` 子路径。

若 nginx 运行在宿主机上：

```dotenv
BIND_ADDRESS=127.0.0.1
HTTP_PORT=8000
PUBLIC_ORIGIN=https://clab.example.com
```

将下面的 location 配置加入**已经配置证书的 HTTPS server 块**，并把 HTTP 请求重定向到 HTTPS：

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/events {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

若代理也运行在同一 Docker 网络中，上游地址改为 `http://c-lab:8000`，不要用代理容器自己的 `127.0.0.1`。这种情况可以通过自定义 Compose 配置取消应用端口对宿主机的发布。

**SSE 必须禁用响应缓冲和缓存。** 不要对 `/api/*` 使用 CDN「缓存所有内容」规则。通过 CDN/代理访问时，检查学生端断线重连与课堂状态重放。

## 4. 更新、停止与健康检查

```bash
# 获取/更新代码后重新构建并替换容器
docker compose up -d --build --wait

# 检查就绪状态：静态 index.html 存在时返回 200 {"ok":true}
curl --fail http://localhost:8000/api/health

# 查看运行状态和日志
docker compose ps
docker compose logs --tail=100 c-lab

# 停止并移除本项目容器与网络
docker compose down
```

镜像内置健康检查；缺少静态入口时 `/api/health` 返回 503。Compose 的 `restart: unless-stopped` 会处理进程退出，但**不会仅因为 health 状态变为 unhealthy 就自动重启**。

`SIGTERM` / `SIGINT` 会关闭 SSE 连接并停止服务，最多等待 10 秒；Compose 留出 15 秒关闭时间。重建/重启会丢失内存中的课堂房间，老师需要重新开始共享。

容器使用非 root 用户运行，Compose 启用只读根文件系统、移除 Linux capabilities 并禁止提升权限。不要把整个仓库或宿主机敏感目录挂载到静态根目录。

## 5. 数据和扩容限制

- 当前不需要持久化卷。课堂状态只在单个 Node 进程内存中保存。
- 学生草稿与课程进度保存在浏览器 localStorage 中，与 origin 绑定；更换域名、协议或端口后不会自动迁移，必要时先导出项目。
- **仅运行一个应用副本。** 不能直接用 `--scale c-lab=2` 或多进程负载均衡；不同副本不会共享 SSE 连接和房间状态。
- 若要多副本，需要实现共享状态/消息广播或按房间路由。数据卷本身不能解决这个问题。
- 课堂码不是完整的用户认证体系。公网使用应另外配置访问控制、连接/请求限制；不要在日志中泄漏老师密钥或学生源码。

## 6. 验证

```bash
# 本机单元测试（完整执行器测试需要 GCC；推荐 Linux 环境）
npm ci
npm test
npm run build

# Docker 冒烟测试（需要本机 Node 22+ 和 Docker；不需要 npm 依赖）
node scripts/docker-smoke.mjs
```

Docker 冒烟测试创建独立的临时 Compose 项目，自动选择 localhost 端口，验证静态资源/WASM、健康检查、PUBLIC_ORIGIN、SSE 发布与重放、SIGTERM 正常退出，然后清理测试容器和网络。不会启动默认 Compose 项目。

也可在 Linux 构建阶段镜像内运行完整单元测试（工具与依赖不会进入运行时镜像）：

```bash
docker build --target build -t c-lab-build-test .
docker run --rm c-lab-build-test npm test
```
