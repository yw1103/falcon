# 猎隼 · 小红书采集管理台

独立于 Spider_XHS 的本地管理后台。React / Radix UI（shadcn 风格）前端、FastAPI 后端、SQLite 持久化。

后续开发先阅读 [AI 开发入口](AGENTS.md) 和 [项目技术交接](docs/PROJECT_HANDOFF.md)。部署参见 [Docker Compose 部署说明](DEPLOY.md)。

## 目录与升级边界

- `Spider_XHS/`：基于上游 `71d077d`，增加了 PC 海外 RedNote 站点配置支持。
- `admin_backend/`：配置、任务、运行日志和外部服务调用。
- `admin_frontend/`：管理页面。
- `admin_backend/app/adapters/spider_xhs.py`：唯一导入上游接口的适配器。

Spider_XHS 的 PC Auth 已支持按账号选择 `xiaohongshu` 或 `rednote` 站点。加拿大及其他海外账号选 RedNote；国内账号选小红书。RedNote 正式 API 使用官网 PC 配置公布的 `webapi.rednote.com`，安全脚本使用 `as.rednote.com`，不通过中间件重写请求。

RedNote 的安全脚本下载与账号签名校验有关，首次未命中 5 分钟缓存时最多等待 60 秒。若直连到 `as.rednote.com` 超时，请为账号或任务配置可用代理；采集错误会显示该步骤的具体诊断。

上游升级在 `Spider_XHS` 内单独完成；站点域名配置属于 PC Auth 正式扩展。如接口变化，再更新对应上游实现与管理层适配器。可通过环境变量 `SPIDER_XHS_PATH` 指向其他上游目录。

## 已实现

- SQLite 保存账号、代理、任务、Dify、AI 提供商和运行结果；后台重启后配置保留。
- 代理地址手动添加，支持 IP:端口及认证地址；默认关闭。任务开启代理后才显示可选列表；失效配置报错，不静默回退直连。关闭代理也禁用系统代理环境变量。
- 账号手机号 / 区号（加拿大默认 `1`）与小红书 Cookie Token 分开手动管理；健康检查会展示可操作的错误诊断。
- 搜索任务 CRUD、草稿 / 启动 / 暂停、单进程定时调度、任务间隔、搜索翻页间隔、试采集。
- 完整搜索筛选参数、原始 JSON 预览；可选获取正文，正式采集以原始数据 JSON 投递到 Dify Workflow / Chat。
- 独立接码 Key 管理与验证码查询弹窗，支持等待、过期、Key 错误及域名限制提示，不自动登录。
- AI 提供商 CRUD，OpenAI 兼容地址 / 密钥 / 模型，连接测试与实际模型试用 API。首版不自动插入采集链路。
- 运行记录及真实采集结果查看，不预置模拟运营数据。

## 首次安装（PowerShell）

Docker 部署请参阅 [Docker Compose 部署说明](DEPLOY.md)，在项目根目录运行 `docker compose up -d --build` 即可启动前后端。

```powershell
cd 'D:\coisshi\猎隼\admin_backend'
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m pip install -r ..\Spider_XHS\requirements.txt
cd ..\Spider_XHS
npm ci
cd ..\admin_frontend
npm ci
npm run build
cd ..
.\start.ps1
```

打开 http://127.0.0.1:8765。API 文档位于 http://127.0.0.1:8765/docs。

前端开发：在 `admin_frontend` 运行 `npm run dev`，访问 http://127.0.0.1:5173，Vite 转发 `/api` 到后台 8765 端口。

## 使用顺序

1. 添加账号，海外账号选择 RedNote 站点并手动粘贴该站点已登录 Cookie。加拿大号码区号填 `1`，手机号不含区号。
2. 如需代理，添加代理地址；账号登录和任务执行分别配置代理开关。
3. 添加 Dify 预设，基础地址包含 `/v1`，输入变量须与工作流定义一致。
4. 创建并保存任务，选择搜索筛选参数和是否获取正文，试采集确认原始数据，然后启动。字段处理交由 Dify。
5. 添加 AI 提供商，连接测试后可以试用模型。

## 数据与运行约束

数据位于 `admin_backend/data/admin.sqlite3`，可通过 `XHS_ADMIN_DATA` 改目录。密钥、Cookie 和带认证的代理地址用 Fernet 加密；备份时必须同时保存同目录的 `secret.key`。两者一起获得者仍可解密，所以此版本仅绑定本机地址，并未加入多用户登录系统。

后台必须使用 **单 worker**；内置调度器串行运行任务，同账号请求有进程内锁。暂停阻止下一轮任务，已经执行的请求会完成。大规模部署可迁移为独立任务队列。

手机号只用作账号标识，不执行自动短信登录。小红书 Cookie Token 由用户手动粘贴；编辑时默认隐藏，可显式查看已保存 Token。

费用中心保留待接入页面，需要提供余额查询的真实 cURL 与响应结构；不推算余额。账号目前提供手动健康检查，未加入自动巡检。

## 验证

```powershell
cd admin_backend
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python -m ruff check app tests
cd ..\Spider_XHS
..\admin_backend\.venv\Scripts\python -m pytest -q tests\test_rednote_site.py
cd ..\admin_frontend
npm run build
```

真实登录、采集、Dify 和 AI 调用需要有效账号及服务密钥；本地测试使用隔离数据库和适配器替身，不消耗实际服务额度。
