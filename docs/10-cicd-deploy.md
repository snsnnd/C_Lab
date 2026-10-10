# CI/CD 与服务器部署

部署链路：

```text
push 到 main
  -> GitHub Actions
  -> npm test + npm run build + Playwright e2e
  -> docker build
  -> SSH 上传部署上下文
  -> 服务器 docker compose up -d --build
  -> Nginx :80
  -> 域名访问
```

## 服务器初始化

服务器需要 Linux、Docker Engine、Docker Compose Plugin 和一个能执行 Docker 的部署用户：

```bash
sudo usermod -aG docker deploy
sudo mkdir -p /opt/c-lab
sudo chown deploy:deploy /opt/c-lab
```

重新登录部署用户后确认：

```bash
docker version
docker compose version
```

防火墙至少放行 `80/tcp`。当前配置提供 HTTP；如果要 HTTPS，需要在 Nginx 前加 TLS 终止，或后续接入 Certbot / Cloudflare。

## GitHub Secrets

在仓库的 `Settings -> Secrets and variables -> Actions` 添加：

| Secret | 必需 | 示例 |
|---|---:|---|
| `DEPLOY_HOST` | 是 | `203.0.113.10` |
| `DEPLOY_USER` | 是 | `deploy` |
| `DEPLOY_SSH_KEY` | 是 | 部署用户私钥全文 |
| `DEPLOY_KNOWN_HOSTS` | 是 | `ssh-keyscan -H 203.0.113.10` 输出 |
| `DEPLOY_PORT` | 否 | `22` |
| `DEPLOY_PATH` | 否 | `/opt/c-lab` |

生成部署密钥并安装公钥：

```bash
ssh-keygen -t ed25519 -C github-actions-c-lab -f ~/.ssh/c-lab-actions
ssh-copy-id -i ~/.ssh/c-lab-actions.pub deploy@SERVER_IP
ssh-keyscan -H SERVER_IP
```

把 `~/.ssh/c-lab-actions` 的私钥内容放入 `DEPLOY_SSH_KEY`，把 `ssh-keyscan` 的输出放入 `DEPLOY_KNOWN_HOSTS`。私钥不要提交到仓库。

## 域名

为域名添加指向服务器公网 IP 的 `A` 记录（IPv6 则添加 `AAAA` 记录）。DNS 生效后访问：

```text
http://your-domain.example
```

Nginx 使用 `server_name _`，因此不需要把域名写进镜像；任何已经解析到该服务器的域名都能访问。课堂同步的 `/api/events` 已关闭代理缓冲，SSE 更新可以实时到达学生浏览器。

## 发布行为

- Pull Request：运行单测、构建、e2e 和 Docker build，不部署。
- Push 到 `main`：完成同样检查后，通过 SSH 上传当前源码，服务器执行 `docker compose up -d --build --remove-orphans`。
- 部署失败时，Actions 会失败；旧容器不会因为上传步骤失败而被主动停止。
- 服务器不需要 GitHub Token，也不需要拉取私有仓库；Actions 通过 SSH 上传部署上下文。

手动部署排查：

```bash
cd /opt/c-lab
docker compose ps
docker compose logs --tail=100 nginx app
docker compose exec nginx wget -qO- http://127.0.0.1/healthz
```
