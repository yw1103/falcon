# Docker Compose 部署

需要 Docker Engine / Docker Desktop 和 Docker Compose v2。使用 Linux 容器；将整个项目（包含 `Spider_XHS`）复制到部署机器。

## 启动

在项目根目录运行：

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=100 falcon
```

打开 http://127.0.0.1:8765，API 文档在 http://127.0.0.1:8765/docs。前端和后端共用一个端口，不需要额外启动 Vite。

如果本机开发后端仍在使用 8765，先停止它，或将 `.env.compose.example` 复制为根目录 `.env` 并设置 `FALCON_PORT=8766`，再访问 http://127.0.0.1:8766。

默认端口只绑定宿主机本地地址。目前应用没有登录认证；服务器部署建议使用带认证和 HTTPS 的反向代理。确需让其他机器直接访问时，在 `.env` 中设置 `FALCON_BIND_HOST=0.0.0.0`，并限制访问来源。

## 国内网络构建

默认已使用国内依赖源，无需额外参数：

| 下载内容 | 默认来源 |
| --- | --- |
| npm 包 | `https://registry.npmmirror.com` |
| Python 包 | `https://pypi.tuna.tsinghua.edu.cn/simple` |
| Debian 软件包 | 阿里云 Debian / Debian Security 镜像 |

npm 锁文件中的 npmjs 下载地址仅在镜像构建时替换，不改变仓库锁文件和包完整性校验。pip / npm 增加了下载超时及重试。所有软件源均可通过根目录 `.env` 覆盖，变量示例见 `.env.compose.example`。

**基础镜像仍需要 Docker 能访问镜像仓库。** 如果报错发生在 `load metadata for docker.io/library/node`、`python` 或出现 Docker Hub 超时，依赖源不会解决该阶段的问题。可以使用以下任一方式：

1. 在 Docker Desktop 的 Settings → Docker Engine 中，合并添加你的可用 `registry-mirrors` 地址，然后 Apply & Restart；Linux Docker 在 `/etc/docker/daemon.json` 配置同一字段后重启 Docker。不要覆盖已有配置。加速地址以云服务商或你实际可用的服务为准。
2. 将 `.env.compose.example` 复制为 `.env`，把 `NODE_IMAGE` 和 `PYTHON_IMAGE` 改成你可访问仓库的完整镜像名。这两个镜像需分别对应 `node:22-bookworm-slim` 和 `python:3.11-slim-bookworm`；不要替换为 Alpine 版本。
3. 若使用本机代理，配置 Docker Desktop 自身的代理设置。管理后台里的任务代理仅作用于采集，不作用于 Docker 拉镜像或构建下载。

修改源或镜像名后重新构建：

```sh
docker compose build --pull falcon
docker compose up -d
```

国内软件源只优化安装下载，不改变 RedNote / Dify 等业务请求地址。国内网络访问海外站点时，仍可在后台按需配置代理。

## 数据持久化与迁移

容器数据绑定到宿主机 `admin_backend/data/`，与当前本机开发模式使用相同的数据目录。已有账号、任务、代理、接码 Key、运行记录可以直接沿用；不要同时运行本机后端与容器后端，否则两个调度器会重复执行任务。

升级镜像不会删除数据。迁移或备份时，先停止服务，再复制整个数据目录，必须同时保留 `admin.sqlite3` 和 `secret.key`（以及存在的 SQLite WAL 文件）。丢失 `secret.key` 会导致无法解密原有凭据。

```sh
docker compose stop
# 复制 admin_backend/data/ 到备份目录
docker compose up -d
```

数据库、Cookie、API Key、接码 Key、代理配置和本地 `.env` 均不会复制进镜像。

## 容器访问代理和其他宿主机服务

容器中的 `127.0.0.1` 指向容器本身。使用宿主机 7890 代理时，在管理后台把代理地址改成：

```text
http://host.docker.internal:7890
```

Compose 已配置宿主机网关映射。宿主机代理还需要开启“允许局域网连接”，或监听 Docker 可访问的网卡地址；仅监听宿主机 `127.0.0.1` 的代理通常无法从容器访问。宿主机防火墙也需允许 Docker 网络访问该端口。

同理，宿主机上的 Dify / AI 服务使用 `host.docker.internal`；部署在其他容器中的服务使用双方共享 Docker 网络内的服务名。账号和任务的代理开关仍分别生效。

## 更新和停止

修改代码或更新 Spider_XHS 后：

```sh
docker compose up -d --build
```

停止并移除应用容器（宿主机数据目录保留）：

```sh
docker compose down
```

应用必须维持单容器、单 Uvicorn worker，内置调度器不支持多副本。容器配置了自动重启和健康检查；健康检查可确认 API 可用，不代表外部账号、代理或 Dify 一定可用。
