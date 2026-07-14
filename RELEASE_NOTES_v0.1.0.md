# GitHub 学习雷达 v0.1.0 发布说明（草案）

> 状态：Release Candidate 文档草案，尚未创建 Git tag 或 GitHub Release。

## 版本目标

`v0.1.0` 提供一条完整的个人开源学习闭环：发现 GitHub 候选、用可解释规则评分、对少量高分项目调用 DeepSeek、生成 Mini 复刻范围和具体学习步骤，并持续保存学习进度。

## 核心能力

- GitHub 多查询发现、README/语言/根目录 enrichment 和候选池。
- “有 / 无 / 未知”工程信号与五维规则评分。
- DeepSeek 结构化分析、批次熔断、规则 fallback 和 Token 记录。
- 3/7/14 天仓库专属方案一次完整生成，包含操作、引用、验证方式、交付物和预计耗时。
- 方案缓存输入哈希与 Prompt/Schema/模型版本控制。
- HttpOnly 匿名会话隔离偏好、收藏、反馈和学习进度。
- 持久化雷达任务、Worker 原子领取、心跳、失败重试和运行历史。
- PostgreSQL 投影重建、数据保留 dry-run 和旧雷达冷归档。
- 桌面/移动导航、候选详情、专注学习模式和无障碍基础状态。

## 部署与迁移

生产环境最低要求：Node.js 22、pnpm 11、PostgreSQL、GitHub Token，以及独立 Worker 或等价任务运行平台。DeepSeek 可选；未配置时使用规则方案。

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:rebuild-radar-projections
pnpm release:check
```

部署后启动 Web 与 Worker，并配置受保护的 Cron。详细步骤见 `DEPLOYMENT.md`。

仓库同时提供 `Dockerfile` 的 `web`/`worker` 非 root target，以及只面向本机/CI 的 `compose.integration.yml`。后者使用隔离 PostgreSQL 验证迁移、雷达事务投影、方案缓存和任务原子领取，不传入 GitHub 或 DeepSeek 密钥。

Web、Worker 和 Migration 提供独立生产配置预检。公开域名改由运行时 `SITE_URL` 提供，同一个 standalone 镜像可部署到预览和正式域名；GitHub Token 只交给 Worker。回滚、数据库恢复和故障演练见 `OPERATIONS.md`。

## 数据迁移说明

- 迁移必须按 `migrations/0001` 到 `0014` 顺序执行。
- `0011` 引入详细方案完整缓存身份，旧方案保留但不会自动命中新缓存。
- `0012` 明确 `radar_runs` 快照与规范化投影边界，并加入重建能力。
- `0013` 增加雷达冷归档表和数据保留索引。
- `0014` 为学习方案后台任务增加同一用户活跃任务唯一约束和项目查询索引。
- 首次连接已有数据库后应执行 `pnpm db:rebuild-radar-projections`。

## 已验证

- 类型检查、规则/存储/限流/任务/缓存/保留测试和生产构建通过。
- 开发与生产模式 HTTP 路由回归通过；生产环境无 PostgreSQL 时健康接口按设计返回 `503 degraded`。
- 仓库卫生非严格模式通过，能识别高置信度敏感信息和缺失发布文件。
- CI 已配置生产 Web 镜像构建和隔离 PostgreSQL 集成任务；需要 GitHub Actions 首次实际运行后才能把它记为通过证据。

## 发布前仍需完成

- 安装 Git、初始化有效 HEAD/index、检查真实跟踪文件和创建首个提交。
- 在本机或 GitHub Actions 实际运行隔离 PostgreSQL 任务，并在生产演练库执行投影重建和数据保留检查。
- 完成 360/390、768、1280/1440px 真实浏览器截图、键盘和屏幕阅读器回归。
- 在受控环境执行 GitHub discovery 与 DeepSeek smoke test。
- 填写真实 GitHub 仓库 URL、在线 Demo、维护者私密联系方式和产品截图。
- 配置分支保护、Required CI、Secret Scanning 和 Private Vulnerability Reporting。

## 已知限制

- 公共雷达全站共享，个人偏好主要用于重新排序和学习方案画像，不会为每位匿名用户单独抓取 GitHub。
- 不提供正式账号、跨浏览器身份恢复、团队协作、付费或通知系统。
- DeepSeek 不可用时输出规则方案，内容可执行但不具备模型生成的仓库归纳能力。
- 本地 JSON 不支持多实例并发；正式环境必须使用 PostgreSQL。
- 冷归档不会自动永久删除，需要部署方配置备份或对象存储生命周期。

## 发布操作

正式发布时复制本文作为 GitHub Release 内容，删除“草案”和未完成项，补充仓库/Demo 链接，然后创建 `v0.1.0` tag。完整门禁见 `RELEASE_CHECKLIST.md`。
