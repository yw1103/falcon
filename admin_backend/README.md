# XHS 管理后台

这个目录是 `Spider_XHS` 的独立管理层。上游已为 RedNote 兼容做局部修改，后续应优先通过适配器接入业务功能。

## 分层

- `Spider_XHS/`：上游底层能力；PC Auth 支持 RedNote 海外生产站点。
- `admin_backend/app/adapters/`：管理服务调用上游的适配器层。
- `admin_backend/app/services.py`：代理策略、任务调度、原始数据采集与 Dify 投递。
- `admin_backend/app/api/`：管理后台 HTTP API。

## 管理能力

1. 代理 CRUD、连通性检查和请求策略（默认直连）。
2. 账号池 CRUD、手机号标识、手动粘贴 Cookie Token、健康检查诊断。
3. 搜索任务、频率控制、账号/代理选择、暂停恢复、运行记录。
4. 单页试采集、完整搜索筛选、可选正文获取、原始 JSON 预览和 Dify 投递。
5. Dify 快捷预设 CRUD。
6. AI 提供商配置、模型连接测试与试用。
7. 费用中心页面（等待真实查询接口）。
8. 独立接码 Key 与短信查询，不自动登录或更新 Cookie。

安装、运行、数据备份与当前限制见上一级 `README.md`。

开发入口见根目录 `AGENTS.md`，详细技术栈与当前契约见 `docs/PROJECT_HANDOFF.md`。密钥、Cookie 和接码 Key 加密保存；手机号为普通配置，短信全文不持久化。不要提交真实个人信息或凭据到 Git。
