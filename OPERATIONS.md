# 生产运行与故障演练手册

本手册只描述平台无关的生产流程。真实域名、数据库地址和密钥必须由部署平台注入，不得写入仓库、镜像、CI 日志或截图。

## 进程与最小权限

| 进程 | 必需配置 | 可选配置 | 不应持有 |
| --- | --- | --- | --- |
| Showcase Web/API | `NODE_ENV`、`APP_DEPLOYMENT_MODE=showcase`、`DATABASE_URL`、`SITE_URL` | `PUBLIC_REPOSITORY_URL`、`PUBLIC_REPOSITORY_PUBLISHED` | `GITHUB_TOKEN`、`DEEPSEEK_API_KEY`；不需要管理员/Cron 密钥 |
| Full Web/API | `NODE_ENV`、`APP_DEPLOYMENT_MODE=full`、`DATABASE_URL`、`SITE_URL`、`CRON_SECRET`、`ADMIN_SECRET` | `DEEPSEEK_PRO_MODEL`（仅缓存身份，不含密钥） | `GITHUB_TOKEN`、`DEEPSEEK_API_KEY` |
| Radar / Study Plan Worker | `NODE_ENV`、`APP_DEPLOYMENT_MODE=full`、`DATABASE_URL`、`GITHUB_TOKEN`、`DEEPSEEK_API_KEY` | DeepSeek Base URL/模型、Worker/GitHub/AI 调优变量 | `ADMIN_SECRET`、`CRON_SECRET`、`SITE_URL` |
| Migration | `NODE_ENV`、`APP_DEPLOYMENT_MODE`、`DATABASE_URL` | 无 | GitHub、DeepSeek、管理员和 Cron 密钥 |
| 外部 Cron | `RADAR_CRON_URL`、`CRON_SECRET` | 无 | 数据库、GitHub、DeepSeek 密钥 |

DeepSeek 真实调用只存在于 Worker：Flash 处理雷达分析，Pro 处理串行学习方案任务。Web 不持有 DeepSeek 密钥。项目没有 OpenAI 服务配置。

## 启动前预检

预检只读取环境变量并返回脱敏结果，不连接数据库，不调用 GitHub 或 DeepSeek：

```bash
pnpm production:check -- --profile=web
pnpm production:check -- --profile=worker
pnpm production:check -- --profile=migration
```

三种 profile 都要求显式的 `APP_DEPLOYMENT_MODE`，并要求 `DATABASE_URL` 包含 `sslmode=require` 或 `sslmode=verify-full`。Web 只有在 `PUBLIC_REPOSITORY_URL` 为合法 GitHub 仓库地址且 `PUBLIC_REPOSITORY_PUBLISHED=true` 时才展示开源链接；仅登记地址不会冒充 Public。showcase Web 检查 HTTPS 公网 `SITE_URL`，并把 GitHub/DeepSeek Key 视为错误；它不需要管理员/Cron 密钥。full Web 另外检查两个不同且长度足够的密钥；Worker 只允许 full 并额外要求 GitHub Token；Migration 接受两种模式且只需要数据库。数字调优项超出代码实际边界时直接失败，Worker 过期窗口过紧或 AI 上限大于推荐上限时给出警告。输出只包含变量名、错误代码和修复方向，不输出变量值。

容器的 Web/Worker `CMD` 会在启动主进程前自动执行对应预检。非容器平台使用 `pnpm start` 启动 Web，生产迁移使用 `pnpm db:migrate:production`。`pnpm start:regression` 会跳过生产配置检查，只允许本地/CI 的降级 HTTP 回归使用。

## 首次部署与常规发布

showcase 只执行 Migration 与 Web 步骤，不创建 Worker 或外部 Cron。发布前后分别请求学习方案 POST/DELETE、雷达刷新 POST 和 Cron GET，必须全部得到 `403 showcase_read_only`；同时比较 `job_runs` 行数，确认没有新增任务。下面的 Worker/Cron 流程只适用于 full。

1. 记录待发布版本、镜像 digest、当前 `schema_migrations` 和最近一条成功 `radar_runs`。
2. 验证数据库备份可以读取，并记录恢复目标时间；未验证备份时不得执行迁移或数据清理。
3. 分别对 Migration、Web、Worker 运行生产预检。
4. 暂停 Worker 领取新任务；保留 Web 读取能力。
5. 使用新版本 Worker 镜像或同一源码运行 `pnpm db:migrate:production`。
6. 已有历史雷达时运行 `pnpm db:rebuild-radar-projections`，核对热快照与三类投影行数。
7. 部署 Web，检查 `/api/health` 的 HTTP 状态和 JSON：必须是 `status: ok`、`storage: postgres`。
8. 部署并恢复 Worker，确认 queued 数开始下降、`staleRunning` 为 0、最近成功时间更新。
9. 调用一次不强制刷新的 Cron，确认鉴权、刷新间隔判断和 `202`/`skipped` 行为。
10. 检查首页、候选池、项目详情、学习方案、收藏、历史、设置、sitemap 和 robots。
11. 观察至少一个 Worker 轮询周期和一轮任务终态，再结束发布观察窗口。

迁移按文件逐个事务执行并记录在 `schema_migrations`。迁移进程在同一数据库会话持有 advisory lock，竞争发布会等待；每个文件记录 SHA-256，已应用文件被修改时迁移直接失败。旧数据库首次升级会为历史迁移补录当前校验和，之后必须保持不变。当前没有自动 down migration；不要通过手工删除列或迁移记录“回滚”数据库。

## 应用回滚

优先回滚应用镜像，不逆向修改数据库。先按模式处理流量和付费能力：

- showcase：确认没有 Cron/Worker 和业务 Key，只能回滚到已验证支持成本防火墙的镜像；如果没有这样的旧镜像，先关闭公网入口或切维护页，不能回滚到不认识 `APP_DEPLOYMENT_MODE` 的版本。
- full：先暂停 Cron，再停止 Worker 领取新任务，保留 Web 只读能力；回滚后确认模式仍为 full 和 schema 兼容，再恢复 Worker，最后恢复 Cron。

随后执行通用回滚步骤：

1. 停止新 Worker，保留失败任务和 `runId` 供审计。
2. 把 Web/Worker 回滚到上一个已验证镜像 digest。
3. 若旧应用兼容当前的向前 schema，恢复 Worker 并检查健康状态。
4. 若 schema 与旧应用不兼容，在新数据库实例恢复发布前备份，验证后切换 `DATABASE_URL`；不要覆盖唯一可用备份。
5. 记录触发原因、影响时间、任务数量、数据库版本和恢复证据。

发布前必须审查新 migration 是否仍与上一版应用向前兼容。包含数据删除、列重命名、约束收紧或大表重写时，应拆成“扩展 → 双写/回填 → 切换 → 后续清理”多个版本。

## 故障处置

### PostgreSQL 不可用

- Web 健康检查应返回 `503`，生产进程不得退回本地 JSON。
- 暂停 Worker 和 Cron，检查连接、证书、连接数、磁盘和提供方事件。
- 恢复后先执行 `SELECT 1`/健康检查，再恢复 Worker；确认没有重复最终雷达和过期 running 任务。

### 任务堆积或 Worker 停滞

- 记录 `/api/health` 的 queued/readyQueued/running/stale 数、最旧可领取任务时间和 `degradedReasons`。延迟重试包含在 queued，但在到达 `availableAt` 前不属于 readyQueued。
- 检查 Worker 是否使用与 Web 相同的数据库、是否通过预检、是否持续输出心跳。
- 过期任务由 Worker 原子恢复；不要直接修改 `job_runs` 状态。恢复后确认每个 `runId` 只有一个终态结果。

### GitHub 限流或失败

- 保留 query warning 和响应分类，不连续强制刷新。
- 检查 Token 权限、额度、查询数量、enrichment 上限和超时；按下一刷新窗口重试。
- 候选部分失败允许形成 partial run，但历史页必须可见失败数。

### DeepSeek 超时或失败

- 雷达分析可继续使用规则 fallback；Pro 学习方案不得把规则内容冒充 AI 结果。
- Pro 对 3/7/14 天周期都使用一次完整生成，默认超时 300 秒；任务通过 `runId` 恢复，页面刷新不应中断 Worker。
- 同一匿名会话只允许一个学习方案任务；排队任务可取消，模型调用开始后不提供中途截断。
- 检查任务阶段、错误分类、耗时和 provider 实际返回的 Token；不估算缺失用量。
- `pnpm ai:smoke` 只在受控环境手动执行一次，不加入普通 CI。

### Cron 鉴权或调度失败

- showcase 固定返回 `403 showcase_read_only`；full 未授权必须返回 `401`，生产缺少 `CRON_SECRET` 必须返回 `503`。
- 核对 Cron URL、Bearer 密钥和时区；普通触发尊重用户设置的刷新间隔，只有维护演练才使用 `force=1`。

## 数据保留与恢复演练

匿名会话令牌固定一年失效，不采用无限滑动续期。Proxy 首次签发时登记服务端记录，后续 API 只续活仍存在且未过期的会话；清除数据后的旧令牌重放必须返回 401。正常会话 API 会至多每 5 分钟触发一次过期回收，每轮最多四个 1000 条批次；PostgreSQL 使用跳锁和过期复核，避免多个 Web 实例与会话续期互相误删。若监控发现过期积压超过该吞吐量，应临时运行同一清理逻辑或缩短调度间隔，不能手工删除关联子表。

1. 先运行 `pnpm data:retention` 保存 dry-run 数量。
2. 核对最少保留 run、学习进度保护、详细方案版本和归档目标。
3. 验证备份后才运行带固定确认字符串的 apply。
4. 每季度至少把备份恢复到隔离数据库，运行迁移、投影重建、健康检查和只读页面验证。
5. 冷归档不是备份；对象存储生命周期和数据库备份必须独立配置。

## 发布证据记录

每次正式发布至少保存：版本/tag、镜像 digest、CI 链接、迁移前后版本、备份时间、Web/Worker 预检结果、健康 JSON、任务 `runId`、回归结果和回滚负责人。记录中只能保存变量名和脱敏错误，不能保存密钥或完整数据库 URL。
