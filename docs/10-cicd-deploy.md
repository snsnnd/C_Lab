# CI：公开 Docker 镜像发布；服务器手动更新

## 架构

```text
push main / 手动运行 main
  -> GitHub Actions: 单元测试 + 前端构建 + Playwright
  -> 构建 linux/amd64 Docker 镜像
  -> 对同一镜像做 smoke（WASM / SSE / SIGTERM）
  -> 推送 GHCR sha-<完整 commit SHA> tag
  -> 验证匿名 pull；仍为 main HEAD 时发布 main tag
  -> 停止：不连接服务器、不触发部署

管理员选择维护时间
  -> 登录服务器 -> 手动 pull 指定 digest -> Compose 更新 C Lab
  -> 验证健康；失败时手动回滚
```

**本仓库不提供服务器自动更新器、systemd timer、安装脚本或 GitHub SSH 部署 job。** 发布新镜像不会自动改变服务器。C Lab 的 Node 静态/SSE 应用服务仍保留；删除的只是运维自动更新代码。

## 1. GitHub 构建与公开发布

工作流：`.github/workflows/ci-cd.yml`。

- Push 到 main、手动运行 main：测试、构建、smoke、发布。
- Pull Request、非 main 分支手动运行：只测试和构建，不发布。
- 使用临时 `GITHUB_TOKEN`，发布 job 授予 `packages: write`；无需 PAT、`DEPLOY_*` secrets 或 production 审批环境。
- Docker 镜像只构建一次，smoke 成功后 push 同一镜像，不在 VPS 重建。
- 发布 job 串行运行，提升 main 前检查当前仓库 main HEAD，避免旧 commit 的迟到任务覆盖新发布；不是当前 HEAD 时保留 SHA 镜像但不提升 main。

镜像地址：`ghcr.io/snsnnd/c_lab`。

| 标识 | 用途 |
|---|---|
| `sha-<完整 commit SHA>` | 追溯源码；同一 commit 重跑可能产生不同内容，tag 本身不是不可变的 |
| `main` | 最新成功提升的镜像，方便发现新版本 |
| `@sha256:<digest>` | 不可变内容标识；推荐手动部署和回滚使用 |

Actions Summary 会给出完整 digest。不要把浮动 main tag 当作已部署版本的持久记录。

### GHCR package 必须公开

公开源码仓库不意味着 package 自动公开。第一次发布可能先创建 private package，然后在匿名 pull 检查处失败；这时不会提升新的 main tag。

1. GitHub → `snsnnd` Packages → `c_lab` → Package settings。
2. 将可见性设为 **Public**，任何人都可以下载该镜像。
3. 确保 package 允许 `snsnnd/C_Lab` Actions 写入；已有同名 package 可能需要管理员授权。
4. 重跑当前 main 的 workflow。

发布流程使用空 Docker config 验证匿名 pull，不自动更改 package 可见性。公开后，服务器无需 GitHub 账号、PAT 或 `docker login`；发布权限与匿名读取是两条独立路径。

## 2. 生产配置

保留 `deploy/compose.production.yaml` 供管理员手动运行。只有 `c-lab` 一个服务，没有 build，保持 loopback `127.0.0.1:8000`、2 CPU / 4 GiB RAM（memory+swap ceiling 8 GiB）、非 root、只读根文件系统和日志轮换。

用户访问路径：浏览器 → Cloudflare HTTPS → Caddy HTTPS → loopback → C Lab。不使用旧 `docker-compose.yml` 的 app/nginx，不重启 Caddy，不操作 KC/KT，不运行 `--remove-orphans` 或全局 Docker 清理。

以下手动命令针对现有 contabo-eu 布局：

```text
/etc/c-lab/compose.production.yaml  从仓库审查后手动安装
/etc/c-lab/compose.env              现有 PUBLIC_ORIGIN 等配置
/etc/c-lab/image.env                C_LAB_IMAGE=<digest 或初始本地 image ID>
```

如果这些文件已存在，先检查和备份，不盲目覆盖。从原源码部署首次迁移、目标两个文件均不存在时，可在服务器的已审查 checkout 执行：

```bash
sudo bash -eu -c '
  test ! -e /etc/c-lab/compose.production.yaml
  test ! -e /etc/c-lab/image.env
  test -f /etc/c-lab/compose.env
  image=$(docker inspect --format "{{.Image}}" c-lab-c-lab-1)
  install -m 600 deploy/compose.production.yaml /etc/c-lab/compose.production.yaml
  printf "C_LAB_IMAGE=%s\n" "$image" > /etc/c-lab/image.env
  chmod 600 /etc/c-lab/image.env
'
```

初始化只准备配置，不更新容器。后续始终显式选择新生产配置，不用 `/opt/c-lab/current` 下的旧 Compose 更新，否则可能还原旧镜像。

## 3. 手动更新

**在维护窗口操作；替换/回滚容器会清空课堂内存。没有自动健康回滚，请逐步检查每条命令的退出状态，失败即停止。** 先确认没有旧自动部署任务或其他管理员同时操作（见第 5 节）。

在服务器执行 `sudo -i` 进入 root Bash，然后：

```bash
# 填入 Actions Summary 中的真实 digest；校验失败不要继续。
IMAGE='ghcr.io/snsnnd/c_lab@sha256:<64位十六进制摘要>'
[[ "$IMAGE" =~ ^ghcr\.io/snsnnd/c_lab@sha256:[0-9a-f]{64}$ ]]

compose() {
  docker compose -p c-lab \
    --env-file /etc/c-lab/compose.env \
    --env-file /etc/c-lab/image.env \
    -f /etc/c-lab/compose.production.yaml "$@"
}
unset C_LAB_IMAGE
compose config --quiet
compose ps

# 下载不影响当前容器；下载失败不要切换。
docker pull "$IMAGE"

# 保存更新前的镜像配置，记住输出路径。
BACKUP=$(mktemp /etc/c-lab/image.env.before-update.XXXXXXXX)
cp -p /etc/c-lab/image.env "$BACKUP"
printf 'Rollback configuration: %s\n' "$BACKUP"

# 原子替换镜像选择。
NEXT=$(mktemp /etc/c-lab/image.env.next.XXXXXXXX)
printf 'C_LAB_IMAGE=%s\n' "$IMAGE" > "$NEXT"
chmod 600 "$NEXT"
mv "$NEXT" /etc/c-lab/image.env

# 此步骤会替换 C Lab 容器。
compose up -d --no-build --no-deps --pull never --wait --wait-timeout 90 c-lab
compose ps
curl --fail --silent --show-error http://127.0.0.1:8000/api/health
curl --fail --silent --show-error https://www.jtkczx.xyz/api/health
curl --fail --silent --show-error https://www.jtkczx.xyz/api/info
```

确认 health 返回 `{"ok":true}`、info 的 publicOrigin 正确，浏览器可加载/执行 C 程序和同步课堂。确认实际镜像 ID 一致：

```bash
docker image inspect --format '{{.Id}}' "$IMAGE"
docker inspect --format '{{.Image}}' c-lab-c-lab-1
```

`--wait` 或后续检查失败时，管理员决定并执行下节回滚。`restart: unless-stopped` 不会拉取新镜像，也不会仅因 unhealthy 自动重启。

## 4. 手动回滚

保留上一镜像和备份，不要 prune。沿用上面的 root shell 与 compose 函数：

```bash
# 若已断开重连，先将 BACKUP 设置为上次保存的实际备份路径。
test -f "$BACKUP"
cp -p "$BACKUP" /etc/c-lab/image.env
compose up -d --no-build --no-deps --pull never --wait --wait-timeout 90 c-lab
compose ps
curl --fail --silent --show-error http://127.0.0.1:8000/api/health
curl --fail --silent --show-error https://www.jtkczx.xyz/api/health
```

回滚也不能恢复课堂内存。若上一镜像已从本地删除，需要先按旧 digest 下载；初始本地镜像可能尚未发布到 GHCR，因此务必保留。

## 5. 旧自动部署设置退役（单独运维步骤）

**删除仓库文件不会删除此前已安装到服务器的文件或权限。** 按实际安装情况另行处理：

- 若曾启用 `c-lab-update.timer`，先 disable/stop timer，再等待或停止 updater service，检查未完成部署；不要与人工更新并行。
- 若有旧 pending journal，先用原部署器完成恢复，或人工核对容器/配置后再退役旧脚本。
- 撤销专用 `clab-deploy` 账号的 authorized_keys 和 `/etc/sudoers.d/c-lab-deploy`；只锁密码不能阻止公钥登录。检查 `visudo -c`，不要动 admin 的 SSH 权限。
- 按需移除旧 updater、forced-command、systemd units，并执行 daemon-reload。
- GitHub 不再需要五项 `DEPLOY_*` secrets、`ENABLE_PRODUCTION_DEPLOY` variable 或专用 production 环境。

本次仓库修改不执行服务器退役操作。

## 6. 本地验证

```bash
docker build --target build -t c-lab-ci-test .
docker run --rm c-lab-ci-test npm test
npm run build
npm run test:e2e
docker build --provenance=false -t c-lab-ci-image .
node scripts/docker-smoke.mjs --image c-lab-ci-image
```

smoke 的 `--image` 模式不重建或删除传入镜像；默认模式仍支持临时构建。保护仓库 main 与 package 写权限；digest 固定内容，但不等同于独立签名验证。
