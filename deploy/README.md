# 帧外公网部署

这个部署包把 Vite 构建产物和 Node.js 后端放入同一个应用镜像。Caddy 提供域名、HTTPS 和反向代理；浏览器通过同一个域名访问页面与 `/api/ai`。它可以部署在国内云厂商的香港节点，也可以部署在已满足备案要求的大陆节点。

目前没有配置真实服务器或域名，没有发起云资源购买或公网部署。本机 Docker 服务尚未启动，镜像构建和证书签发还未验证。

## 部署前

1. 准备一台有公网地址的 Linux 服务器，安装 Docker Engine 和 Docker Compose v2。不要在已有业务占用的 80/443 端口上直接启动此配置。
2. 准备自己的域名，将选定主机名的 A 记录指向服务器公网 IPv4。只有服务器可正常接收 IPv6 时才设置 AAAA 记录。
3. 服务器安全组和系统防火墙允许入站 TCP 80、443。SSH 只供维护使用；此配置不会向公网发布应用的 8000 端口。
4. 域名解析到大陆服务器时，先完成接入云厂商要求的 ICP 备案。香港节点不需要 ICP 备案。具体要求见[腾讯云官方说明](https://cloud.tencent.com/document/faq/243/19630)。是否需要备案取决于服务器地区，不能通过换端口解决。

域名和 HTTPS 解决公开访问入口问题，但不能保证微信立即允许访问。发布后仍需用微信在移动网络中打开实际域名验证；如果微信给出域名风险拦截提示，应按页面指引核查和申诉。

## 服务器上构建并启动

将源码放到服务器上的一个独立目录，例如 `/opt/frameout`，然后在项目根目录运行：

```bash
cp deploy/.env.example deploy/.env
```

编辑 `deploy/.env`，只填写自己的主机名，例如 `FRAMEOUT_DOMAIN=studio.your-domain.com`。不要填写 `https://`、端口或路径，也不要放 API Key。然后运行：

```bash
docker compose --env-file deploy/.env config --quiet
docker compose --env-file deploy/.env up -d --build
docker compose --env-file deploy/.env ps
docker compose --env-file deploy/.env logs --tail=100 caddy app
```

域名解析和 80/443 入站正确后，Caddy 会申请证书并自动续期。证书保存在 `caddy_data` 卷中；日常停止或更新不要使用 `down -v` 删除该卷。

镜像构建需要访问 Node 基础镜像仓库与 npm 包索引。如果服务器无法访问这些源，可以在能联网的机器构建同架构镜像，再传到服务器；不要直接使用来源不明的镜像代理。

## 在其他机器构建后传入

先在服务器运行 `uname -m` 确认架构：`x86_64` 对应 `linux/amd64`，`aarch64` 对应 `linux/arm64`。以下以 AMD64 为例：

```bash
docker buildx build --platform linux/amd64 --load -t frameout:local .
docker save -o frameout-image.tar frameout:local
```

将 `frameout-image.tar`、`compose.yaml`、`deploy/Caddyfile` 和已填写的 `deploy/.env` 传入服务器相同的项目目录结构，再运行：

```bash
docker load -i frameout-image.tar
docker compose --env-file deploy/.env up -d --no-build
```

Caddy 镜像也需要服务器能够拉取；无法拉取时，可在同架构构建机上拉取 `caddy:2-alpine` 并用 `docker save` / `docker load` 一并传入。

## 发布后验收

- 访问 `https://你的域名/api/health`，应返回 `{"status":"ok","service":"frameout-api"}`。
- 打开首页，进入画布，上传图片或视频，试用镜头编排、缩放、返回首页再进入、刷新恢复。
- 从手机移动网络打开，再从微信聊天中的实际 HTTPS 链接打开。
- 真实生成仍需供应商 Key 和模型权限。服务器能够展示网页不代表服务器能够连接每个供应商；未使用真实 Key 验证前，不宣称出图或出片已通过。

API Key 仍只保留在访问者页面内存，并由后端用于当次转发。该部署不需要站点运营者提供公共 Key。不要把真实 Key 写入镜像、部署环境文件或分享出来。

项目结构和素材仍保存在各访问者的浏览器本地。不同设备不会自动同步，迁移到新域名也不会自动继承旧域名的本地数据。当前没有账号系统、云端项目库或多人协作。

## 更新和停止

在服务器更新源码后，运行同一条 `docker compose --env-file deploy/.env up -d --build`。如果使用预构建镜像，先加载新镜像，再运行 `up -d --no-build --force-recreate app`。停止服务使用：

```bash
docker compose --env-file deploy/.env down
```

部署配置将 `FRAMEOUT_DOMAIN` 对应的 HTTPS Origin 加入应用允许列表。更换主机名后需同时修改 DNS 和 `deploy/.env`，并重新执行 `up -d`，使 Caddy 和 FastAPI 一起采用新域名。

参考：[Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)、[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
