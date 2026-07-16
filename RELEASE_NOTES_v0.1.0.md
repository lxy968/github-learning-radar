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
- Showcase/Full 双运行模式：公开作品集不持有模型 Key、不创建付费任务，Fork 后可用自己的 Key 完整自部署。
- Showcase 内置同一公开仓库经 DeepSeek Pro 真实生成并验收的 3/7/14 天完整方案；浏览器只获得学习内容，不获得内部模型、调用轨迹或 Token 元数据。
- 完整 Git 历史敏感信息扫描、依赖漏洞门禁、迁移锁/校验和和生产 PostgreSQL TLS 要求。

## 部署与迁移

两种生产模式都要求 Node.js 22、pnpm 11 和 PostgreSQL。公开作品集使用 `APP_DEPLOYMENT_MODE=showcase`，只部署 Web，不配置 GitHub/DeepSeek Key、Worker 或 Cron；Fork 后的完整实例使用 `full`，Web 只负责入队，独立 Worker 才持有部署者自己的 GitHub Token 和 DeepSeek Key。

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:rebuild-radar-projections
pnpm release:check
```

Showcase 已选定 Vercel Hobby + Neon Free 的零付费组合，运行时使用池化数据库 URL、迁移使用直连 URL；完整实例按需部署 Web、Worker 和受保护 Cron。详细步骤见 `DEPLOYMENT.md`。

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

- 类型检查、逻辑与安全回归、严格仓库卫生、`git diff --check`、生产构建和 full/showcase 双模式 HTTP 回归通过；普通门禁没有调用 DeepSeek。
- 完整 Git 历史扫描通过，覆盖 290 个文本 blob 路径；生产依赖审计返回 `No known vulnerabilities found`。
- GitHub Actions 已实跑 Web/Worker 镜像、PostgreSQL 16 迁移与集成测试；本次未提交改动新增的会话竞态、迁移锁/校验和场景仍待推送后的远程 CI。
- Showcase 生产构建已走通首页、项目详情、3/7/14 天预置方案、完成一步和刷新恢复；多视口无控制台错误。真实键盘、屏幕阅读器和独立 Cookie 上下文仍未完成。
- 已按授权记录 DeepSeek Flash/Pro 受控生成的模型、次数、耗时和 Token；当前入库的 3/7/14 天方案分别完整生成，普通发布门禁不会再次调用模型。

## 发布前仍需完成

- 审核并提交当前发布候选，推送后确认新增 GitHub Actions 与 PostgreSQL 场景全部绿色。
- 完成真实键盘、屏幕阅读器、断网恢复和两个独立浏览器会话的人工回归。
- 在 Neon Free 演练库执行迁移、健康、数据计数、备份恢复和回滚，证明 Showcase 访问前后没有任务/provider Token 增量。
- 将已登记的 GitHub 仓库切换为 Public，并在真实上线验收后补在线 Demo、维护者私密联系方式和产品截图。
- 配置分支保护、Required CI、Secret Scanning 和 Private Vulnerability Reporting。

## 已知限制

- 公共雷达全站共享，个人偏好主要用于重新排序和学习方案画像，不会为每位匿名用户单独抓取 GitHub。
- 不提供正式账号、跨浏览器身份恢复、团队协作、付费或通知系统。
- full 自部署在 DeepSeek 不可用时会明确提示失败或使用对应规则 fallback；公开 showcase 始终读取已经验收的真实生成缓存，不承诺现场生成。
- 本地 JSON 不支持多实例并发；正式环境必须使用 PostgreSQL。
- 冷归档不会自动永久删除，需要部署方配置备份或对象存储生命周期。

## 发布操作

正式发布时复制本文作为 GitHub Release 内容，删除“草案”和未完成项，补充仓库/Demo 链接，然后创建 `v0.1.0` tag。完整门禁见 `RELEASE_CHECKLIST.md`。
