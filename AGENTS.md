# 后续 AI 开发入口

先阅读 `docs/PROJECT_HANDOFF.md`，运行和安装见 `README.md`，Docker 部署见 `DEPLOY.md`。这些文档描述当前实现；修改业务契约后同步更新。

## 项目目标与约束

- 项目名“猎隼”，是 Spider_XHS 的管理中间层，负责配置、采集调度、原始数据保存及 Dify 投递。字段提取、段落生成和业务分析交给 Dify。
- 账号以手动 Cookie Token 认证，手机号只是标识；9527sms 接码是独立查询工具，不执行自动登录，也不更新 Cookie 或账号状态。
- 海外加拿大账号默认 `rednote`，大陆账号使用 `xiaohongshu`。不要将 RedNote 请求改回大陆域名。
- 账号和任务代理开关分别生效。关闭时明确直连；任务不继承账号代理配置。禁止静默回退。
- 搜索原始数据不能丢字段；获取正文默认关闭，开启后在每条搜索 item 上附加 `note_detail` 与获取状态。
- SQLite 数据和 `secret.key` 必须一起保留；不删除用户已有账号、任务、运行记录。不要输出或提交 Cookie、接码 Key、API Key、代理认证信息、本地数据或 `.env`。
- 内置调度器仅支持一个后端实例、一个 Uvicorn worker。不得为了性能直接增加 workers 或容器副本。
- 业务修改优先在 `admin_backend` 和 `admin_frontend`。用户已允许为接口兼容修改 `Spider_XHS`，但应保持改动范围小，并记录原因。

## 代码入口

- 后端 `admin_backend/main.py` → `app/__init__.py` → `app/api/management.py`。
- Schema：`admin_backend/app/models.py`；存储与加密：`app/storage.py`。
- 调度、任务、代理策略、Dify：`admin_backend/app/services.py`（文件，不是目录）。
- 唯一上游业务适配器：`admin_backend/app/adapters/spider_xhs.py`。
- 前端页面与表单：`admin_frontend/src/main.jsx`；基础组件：`src/components/ui.jsx`；样式：`src/styles.css`。
- Spider 详情/搜索：`Spider_XHS/apis/xhs_pc_apis.py`；站点和签名见交接文档。

## 修改与验证

任务新增字段时同时更新后端 Task schema、前端 `defaults.tasks`、表单、适配器参数及 run 搜索参数快照；旧任务需有默认值兼容。

后端测试使用隔离临时数据库，避免对真实账号执行测试。Windows 下使用项目虚拟环境，不要误用缺少依赖的系统 Python：

```powershell
cd admin_backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app tests
cd ..\admin_frontend
npm run build
```

RedNote 上游改动另运行 `admin_backend/.venv/Scripts/python.exe -m pytest -q Spider_XHS/tests/test_rednote_site.py`（从根目录运行需要设置 `PYTHONPATH=Spider_XHS`，或进入 Spider_XHS 后调用该解释器）。浏览器测试使用 `npm run test:e2e`，具体服务启动设置见 `admin_frontend/playwright.config.js`。

不要默认认为服务已启动。先检查端口和实际进程；本地后端不使用 reload，代码变更后需重启才能生效。不要同时运行本地后端与读取同一数据目录的 Docker 后端。

仓库现状：根目录及两个管理目录当前没有 Git 仓库，`Spider_XHS` 有独立 `.git`。已有上游修改不能被 reset/checkout 覆盖；此前 `.env.example` 的删除是已有工作区状态。
