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

### Changed

- 刷新状态改为持久化任务，跨页面保持运行阶段和进度。
- README 与工程信号明确区分“有 / 无 / 未知”，未知不再按缺失扣分。
- 候选搜索、筛选、排序和分页移到服务端。
- AI provider 收敛为 `DeepSeek → 规则`，不调用 OpenAI 服务。
- `radar_runs` 成为唯一运行时读取源，规范化表作为可重建投影。
- GitHub Token 收敛到 Worker；Web 只负责管理员鉴权和持久化任务入队。

### Security

- 写接口使用 HttpOnly 匿名会话、限流、管理员/Cron 鉴权和错误脱敏。
- CI 使用只读权限，仓库卫生门禁扫描常见 Token、私钥和带密码数据库 URL。
- 数据清理默认 dry-run，apply 需要固定确认字符串，并在删除热雷达前写入归档。

### Known limitations

- `v0.1.0` 尚未正式发布；Git、真实浏览器多视口和当前工作区 PostgreSQL 实跑门禁仍待完成。
- 当前没有正式账号系统，匿名 Cookie 丢失后无法恢复原会话数据。
- 本地 JSON 仅适合单机开发，生产环境必须使用 PostgreSQL 和独立 Worker。
