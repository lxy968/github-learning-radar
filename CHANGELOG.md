# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，并使用语义化版本号。

## [Unreleased]

### Added

- GitHub 候选发现、enrichment 三态信号、规则评分和服务端候选分页。
- DeepSeek 结构化分析、规则 fallback、调用轨迹和 Token 统计。
- 3/7/14 天具体学习方案、版本化缓存、步骤点亮和匿名会话进度同步。
- 持久化后台任务、心跳、过期恢复、健康检查和定时刷新。
- PostgreSQL schema、雷达规范化投影、数据归档与保留命令。
- 非 root Web/Worker 容器 target、隔离 PostgreSQL Compose 和事务集成验证入口。
- Web/Worker/Migration 生产配置预检、运行时 `SITE_URL`、最小权限密钥边界和故障恢复手册。
- 仓库卫生扫描、CI、Dependabot、Issue/PR 模板和发布检查表。
- `showcase`/`full` 双运行模式、公开零 Token 成本防火墙、内置三天方案和匿名进度闭环。
- 完整 Git 历史敏感信息扫描、生产依赖中危门禁和 Vercel/Neon 零付费 Showcase 部署配置。

### Changed

- 刷新状态改为持久化任务，跨页面保持运行阶段和进度。
- README 与工程信号明确区分“有 / 无 / 未知”，未知不再按缺失扣分。
- 候选搜索、筛选、排序和分页移到服务端。
- AI provider 收敛为 `DeepSeek → 规则`，不调用 OpenAI 服务。
- `radar_runs` 成为唯一运行时读取源，规范化表作为可重建投影。
- GitHub Token 收敛到 Worker；Web 只负责管理员鉴权和持久化任务入队。
- Worker 在雷达/学习方案间公平轮转；队列健康区分延迟重试、可领取积压和 stale 运行。
- 迁移增加 session advisory lock、逐文件 SHA-256，生产 PostgreSQL 强制 TLS。

### Security

- 写接口使用 HttpOnly 匿名会话、限流、管理员/Cron 鉴权和错误脱敏。
- CI 使用只读权限，仓库卫生门禁扫描常见 Token、私钥和带密码数据库 URL。
- 数据清理默认 dry-run，apply 需要固定确认字符串，并在删除热雷达前写入归档。
- 匿名令牌固定失效期且删除后不可重建；反馈负载和任务状态按会话所有权收口。
- CI 使用完整克隆运行历史敏感信息扫描，并阻止中危及以上生产依赖漏洞。

### Known limitations

- `v0.1.0` 尚未正式发布；仓库公开、当前改动的远程 CI、真实云 PostgreSQL 和在线 Demo 仍待外部授权。
- 浏览器多视口和主流程已验证，真实键盘、屏幕阅读器、断网恢复和独立双会话仍需人工证据。
- 当前没有正式账号系统，匿名 Cookie 丢失后无法恢复原会话数据。
- 本地 JSON 仅适合单机开发；生产环境必须使用 PostgreSQL，只有完整自部署模式需要独立 Worker。
