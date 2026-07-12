# 安全政策

## 报告安全问题

请不要在公开 Issue 中披露可利用的漏洞、Token、数据库连接串或用户数据。

在仓库启用 GitHub Private Vulnerability Reporting 后，请通过仓库的 **Security → Report a vulnerability** 提交报告。在该功能启用前，请联系仓库维护者并使用私密渠道。

报告应尽量包含：

- 受影响的路由或版本；
- 最小复现步骤；
- 可能影响；
- 已确认不会泄露的测试证据。

## 部署安全基线

- `GITHUB_TOKEN`、`DEEPSEEK_API_KEY`、`DATABASE_URL`、`CRON_SECRET`、`ADMIN_SECRET` 只能保存在部署平台的加密环境变量中。
- 生产环境必须配置 PostgreSQL，不应依赖 `.data` 本地文件。
- 全站刷新只能由受保护的 Cron 或管理员请求触发。
- DeepSeek 生成接口必须保留限流、缓存和错误脱敏。
- 数据库迁移应在发布前单独执行，并保留备份。
- Web、Worker、Migration 必须按 `OPERATIONS.md` 分离密钥；Web 不持有 `GITHUB_TOKEN`，Worker 不持有管理员或 Cron 密钥。
- 生产进程启动前执行对应的 `production:check`，检查结果不得输出变量值。

## 支持版本

当前仅维护默认分支的最新版本。正式发布版本后，本节应改为明确的版本支持表。
