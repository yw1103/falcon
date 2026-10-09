# 猎隼项目交接

更新日期：2026-10-09。以实际代码和依赖清单为准；此文档不包含任何真实凭据。

## 技术栈

| 层 | 当前技术 | 主要文件 |
| --- | --- | --- |
| 前端 | React 19、JavaScript JSX、Vite 6、原生 CSS | `admin_frontend/package.json`、`src/main.jsx` |
| UI | Radix Dialog/Switch、Lucide 图标、自定义组件，shadcn 风格 | `src/components/ui.jsx`、`src/styles.css` |
| 后端 | Python >=3.10，本机/Docker 用 3.11；FastAPI、Uvicorn、Pydantic 2 | `admin_backend/pyproject.toml` |
| 存储 | Python sqlite3、SQLite WAL、JSON 文档记录、cryptography Fernet 加密 | `app/storage.py` |
| 调度 | 进程内 threading 调度线程和锁，无外部队列 | `app/services.py` |
| 外部服务 | httpx（含 SOCKS），Dify Workflow/Chat、OpenAI 兼容 AI、9527sms | `app/api/management.py`、`app/services.py` |
| Spider | 本地 Spider_XHS Python API，curl_cffi 0.15.0、requests、Node.js 签名、crypto-js | `Spider_XHS/requirements.txt`、`package.json` |
| 质量检查 | pytest、ruff；前端 Playwright、Prettier、Vite build | 各目录 tests、配置文件 |
| 部署 | Docker 多阶段构建，Node 22 Bookworm + Python 3.11 Bookworm；Compose v2 | 根目录 `Dockerfile`、`compose.yaml` |

UI 目前没有使用 TypeScript、Tailwind 或完整 shadcn CLI 生成体系。持久化目前没有 ORM、PostgreSQL 或 Redis；不要依据页面风格假设已有这些依赖。

## 运行结构

```text
React 页面 → /api → FastAPI 管理 API
                   ├─ SQLite 配置/运行记录 + Fernet 凭据加密
                   ├─ 调度器 → SpiderXHSAdapter → Spider_XHS 搜索/详情
                   ├─ 原始 notes + 搜索参数 → Dify
                   ├─ AI 提供商测试/模型试用
                   └─ 9527sms 独立短信查询
```

开发时 Vite 在 5173，把 `/api` 转发到后端 8765。构建后 FastAPI 挂载 `admin_frontend/dist`，前后端共用 8765。Docker 使用同一模式，不运行 Vite 开发服务。

## 数据与凭据

SQLite 表为 `records(kind, id, payload)`，`payload` 是 JSON；kind 包括 `accounts`、`proxies`、`tasks`、`dify`、`providers`、`runs`。保存时维护 UUID、created_at、updated_at。API 列表只返回脱敏配置。

默认数据目录 `admin_backend/data`，环境变量 `XHS_ADMIN_DATA` 可覆盖。`secret.key` 是 Fernet 密钥；`cookie`、`sms_key`、`api_key`、代理 URL 加密。手机号目前是普通配置字段，并非加密字段。账号 Cookie 有显式查看接口，接码 Key 和 API Key 不回显。编辑凭据留空保留原值，目前没有单独的“清空密钥”操作。

Task schema 拒绝额外字段。前端编辑只从 defaults 中选出可编辑字段；运行元数据不能整体当作 PUT body。旧数据中可能残留 `selected_fields` / `paragraph_template`，现有执行流程不使用它们，后续不应恢复字段模板流程。

## 业务契约

### 账号与短信

账号支持 `rednote`（默认）/ `xiaohongshu`。Cookie 必须至少有 `a1` 和 `web_session`。健康检查通过上游 bootstrap 获取 user_id；过期时提示手动更新 Cookie。

`POST /api/accounts/{id}/sms` 单次查询 `http://www.9527sms.cc/api/sms/record?key=...`，读取加密保存的接码 Key，不需要有效 Cookie。前端每隔 5 秒查询，最多 60 次，关闭弹窗停止下一次轮询；单次已发请求可能完成。结果状态为 received / waiting / expired / invalid_key / forbidden / error；全文只在弹窗显示，不持久化。HTTP 请求失败返回 502。目前接码请求独立直连、timeout 10 秒，不继承采集代理。

### 搜索参数

| 字段 | 默认 | 语义 |
| --- | --- | --- |
| keyword | 必填 | 搜索关键词 |
| max_items | 20 | 每轮条数，1–1000；run 快照名为 query_num |
| interval_seconds | 300 | 每轮执行完成后等待，最少 10 秒 |
| request_interval_seconds | 5 | 翻页和详情请求间隔，最少 1 秒 |
| fetch_content | false | 开启才逐篇获取正文 |
| sort_type_choice | 0 | 0 综合、1 最新、2 点赞、3 评论、4 收藏 |
| note_type | 0 | 0 不限、1 视频、2 普通 |
| note_time | 0 | 0 不限、1 一天、2 一周、3 半年 |
| note_range | 0 | 0 不限、1 已看、2 未看、3 已关注 |
| pos_distance | 0 | 0 不限、1 同城、2 附近 |
| geo | null | 距离非零必填 latitude/longitude；纬度 ±90、经度 ±180 |

试采集只搜索第一页，最多 `min(max_items,20)`，不投递 Dify；如果开启正文，试采集同样获取详情，耗时会增加。编辑表单当前要求先保存任务；表单试采集会先 PUT 当前配置。

正式采集按 max_items 翻页；搜索失败会导致本轮 failed。搜索 curl 28 超时最多重试一次，重试等待 1–3 秒，不重试其他业务失败。上游搜索 timeout 为 45 秒。

正文获取复用相同 auth/proxy，取搜索 item 的 id/note_id 和 xsec_token 构造当前站点 URL，再调用 `get_note_info`。结果追加 `note_detail`（完整详情接口响应）、`content_status`，失败追加 `content_error`；保留原搜索 item。非 note item 跳过。正文单篇失败不会使整轮失败，目前详情 timeout 仍是上游全局 15 秒，没有详情重试。详情正文通常位于 `note_detail.data.items[*].note_card.desc`，以上游实际返回为准。

### Dify 与运行记录

run 保存 task_id、task_name、sample、status、count、search 参数快照、notes；失败保存 error。Dify 失败标记 delivery_failed，采集数据仍保留。列表目前最多返回最近 100 条，但数据库无自动清理策略。

投递内容固定为以下对象的 JSON 字符串，放在 `inputs[预设.input_variable]`，默认变量名 content。Chat 同时将这个字符串作为 query：

```json
{"search":{"keyword":"示例","query_num":20,"fetch_content":false},"count":1,"notes":[{"id":"example","note_card":{"display_title":"示例"}}]}
```

实际 search 包含完整筛选参数。平台不抽取字段、不拼段落，Dify 工作流负责解析 JSON、选字段和业务处理。调用采用 blocking，timeout 120 秒，Dify 也使用任务所选代理。没有独立投递重试/补发队列。

### 代理

手动代理支持无 scheme 的 IP:端口、HTTP/HTTPS/SOCKS5/SOCKS5H，兼容中文冒号。关闭代理不使用系统代理变量；开启必须选有效配置。账号检查用账号代理，任务用任务代理，互不继承。

检查访问 `https://www.rednote.com/`，timeout 15 秒、跟随跳转；失败显示脱敏 last_error。此前检查固定访问大陆首页，302 被 raise_for_status 判失败，已修复。容器中宿主机代理地址用 `host.docker.internal`，参见 DEPLOY.md。

## 上游改动与升级

上游目录独立 Git，README 记录基于 `71d077d`；升级前检查实际 git status/diff。

- `xhs_utils/xhs_core/auth.py`、相关 exports、`xhs_pc/auth.py`：RedNote 站点支持，API/search 为 `webapi.rednote.com`，security 为 `as.rednote.com`，Cookie 域 `.rednote.com`。
- `xhs_utils/xhs_pc/params.py`：请求头适配站点 origin/referer。
- `xhs_utils/xhs_pc/dsl.py`：RedNote 安全脚本可使用 requests HTTP/1.1，60 秒超时；缓存约 5 分钟。
- `apis/xhs_pc_apis.py`：搜索/站点适配及搜索 timeout 45 秒。详情复用上游现有 feed API。
- `tests/test_rednote_site.py`：域名、header、安全脚本行为测试。

升级不能覆盖这些兼容改动。管理层通过 `SPIDER_XHS_PATH` 加载上游，默认项目里的 Spider_XHS。

## 当前限制与验证范围

- 费用中心只是待接入页面，需要真实余额查询 cURL 和响应结构。
- AI 提供商支持 CRUD、/models 测试、模型试用；没有自动参与任务处理。
- 尚无多用户登录、角色权限、自动账号巡检、自动短信登录、外部任务队列。
- 暂停仅阻止下一轮，不中断当前网络请求；账号和任务锁仅在进程内。
- 后端测试最近为 16 项通过，代理修复后前端构建通过。真实接码用户已确认可用，宿主机代理实际检测成功。其他外部调用需要真实凭据验证，单元测试多使用替身。
- Docker 配置已解析检查，但当前开发机器无 docker 命令，镜像构建及容器运行尚未实测。
- Docker 构建默认使用 npmmirror、清华 Python 和阿里云 Debian 镜像源；Compose 支持用 build args 覆盖源及 Node/Python 基础镜像。管理镜像仅安装 Spider PC API 依赖，不装完整上游 OpenCV/NumPy 环境；Linux Docker runtime 锁定 curl_cffi 0.14.0，因为当前镜像源没有 0.15.0 的兼容 wheel。Docker Hub 拉取加速或代理需要部署机器自行配置，详见 DEPLOY.md。

新 AI 开始工作时：先读 AGENTS.md 和此文档，确认工作区状态与服务进程，再针对需求定位代码、实现和验证；不需要重建整个项目，也不要假定聊天里的临时进程 ID 仍有效。
