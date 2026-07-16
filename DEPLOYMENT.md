# 部署指南

## 推荐架构

生产环境应保持 Next.js 应用无状态：

```text
Browser → Next.js Web/API → PostgreSQL
                         ↘ GitHub API
                         ↘ DeepSeek
Cron/Admin → 受保护刷新入口 → PostgreSQL 任务队列 → 独立 Worker（4.3）
```

当前 Web/API 已改为快速创建持久化任务并返回 `202`，雷达刷新和 Pro 学习方案都不在浏览器请求中等待外部 API。3/7/14 天学习方案分别由一次模型调用完整生成，同一匿名会话只允许一个周期运行。开发环境会自动执行已入队任务；生产环境必须另行启动 `pnpm worker:radar`（该 Worker 现在同时领取雷达与学习方案任务），否则任务会保持 `queued`。

用户偏好、收藏和反馈已按 HttpOnly 匿名会话隔离，公共雷达结果仍为全站共享。匿名 Cookie 丢失后无法恢复原数据；若未来需要跨浏览器身份恢复，再接入正式登录和账号绑定。

## 两种生产运行模式

- `APP_DEPLOYMENT_MODE=showcase`：用于公开简历作品集。Web 对策展推荐、学习方案和付费任务保持只读，但仍可按匿名会话保存偏好、收藏和学习进度；不配置 GitHub/DeepSeek Key，不启动 Worker，不配置外部 Cron。学习方案生成/取消、雷达手动刷新和 Cron 路由都会在鉴权、会话或任务数据库写入前返回 `403 showcase_read_only`，内部入队和 Worker 函数也有第二层拒绝。
- `APP_DEPLOYMENT_MODE=full`：用于 Fork 后的完整自部署。Web 负责匿名会话、鉴权、入队和查询，Worker 才持有 GitHub Token/DeepSeek Key 并执行任务，外部 Cron 只持有 Cron URL/Secret。

仓库的 `.env.example` 安全默认到 showcase；只有明确要运行完整实例时才改为 full。full 允许匿名访客对缓存未命中的普通方案发起生成，费用由部署者承担；公网 full 在登录/配额完成前应放在平台访问控制或私有网络后。

生产环境没有设置或写错该变量时，应用运行时自动按 `showcase` 处理，避免意外创建付费任务；`production:check` 会同时将其视为配置错误并阻止正式进程启动，不能依赖隐式默认值发布。

showcase 内置一组已经真实调用 DeepSeek Pro 生成并验收过的 3/7/14 天完整方案，使用稳定版本 ID，不写入方案表、不创建任务、不读取 DeepSeek Key。公开接口只返回学习内容，不下发内部模型 ID、调用轨迹、Token 或缓存元数据；这些生成证据只保留在仓库内的只读 fixture 中。线上展示不会因访客访问而再次消耗模型额度。

## 本项目的零付费 Showcase 方案

截至 2026-07-16，作品集版选择 **Vercel Hobby + Neon Free**：

- Vercel Hobby 为个人、非商业项目的 `$0/月` 方案；免费账号受硬额度限制且不能购买额外用量，适合本项目的秋招作品集。不要升级 Pro、不要添加付费用量；达到限额时接受站点暂时受限，不转为自动扣费。Next.js 可由 Vercel 原生部署，每次部署自动获得一个先到先得的 `*.vercel.app` 地址。参考 [Vercel Pricing](https://vercel.com/pricing)、[Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) 和 [Vercel Domains](https://vercel.com/docs/domains/working-with-domains)。
- Neon Free 为 `$0/月`、无期限且无需信用卡，当前每项目包含 100 CU-hours/月和 0.5 GB 存储，空闲时可缩到零；达到免费额度时接受数据库能力受限，不升级 Launch。参考 [Neon Pricing](https://neon.com/pricing)。
- 线上仅运行 `showcase` Web，不创建 Worker、Cron、GitHub Token 或 DeepSeek Key，因此公开访客不能发起任何模型任务。Vercel 的 `vercel.json` 只固定 Next.js 和“生产预检后再构建”，不提交环境变量、密钥或定时任务。

免费额度和平台规则会变化，正式部署当天必须重新核对上述官方页面。只要任一平台要求绑卡、开启按量计费或升级付费方案，就暂停上线并重新选择，不默认接受费用。

### 首次部署顺序

以下步骤属于外部状态变更，必须先得到维护者明确授权：

1. 本地门禁和完整 Git 历史扫描通过后，先把发布提交推送到仍为 Private 的 GitHub 仓库并等待 CI 全部绿色；不要在部署验收前公开。
2. 创建 Neon Free 项目。Web 使用带 `-pooler` 的池化连接串；迁移必须使用不带 `-pooler` 的直连串，因为 Neon 的事务池不适合 session advisory lock。两者都保留 `sslmode=require`，连接串只保存在对应平台 Secret 或当前迁移进程中。
3. 使用直连串运行 `pnpm production:check -- --profile=migration` 和 `pnpm db:migrate:production`。迁移完成后立即从本地进程清除该变量，不写入 `.env.local`、命令日志或仓库文件。
4. 在 Vercel Hobby 授权读取这个 Private GitHub 仓库并导入项目，Framework 保持 Next.js，Node 使用仓库声明的版本，包管理器按 `packageManager` 使用 pnpm。建议将 Ignored Build Step 设为“Only build production”，避免预览分支共享生产数据库并消耗免费额度。
5. 首次验收时仅为 Production 配置下列变量并触发一次部署：

   ```text
   APP_DEPLOYMENT_MODE=showcase
   DATABASE_URL=<Neon pooled URL，含 sslmode=require>
   SITE_URL=https://<实际项目名>.vercel.app
   PUBLIC_REPOSITORY_URL=https://github.com/lxy968/github-learning-radar
   PUBLIC_REPOSITORY_PUBLISHED=false
   ```

   不设置 `GITHUB_TOKEN`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、`ADMIN_SECRET` 或 `CRON_SECRET`。Vercel 环境变量变更只对新部署生效，因此修改后必须重新部署。
6. 部署后要求 `/api/health` 返回 `status: ok`、`storage: postgres`，再执行 showcase HTTP/浏览器流程、双匿名会话隔离和数据库前后计数。确认 `job_runs`、provider 调用数与 Token 指标没有增加后，才把 GitHub 仓库切换为 Public，并将 `PUBLIC_REPOSITORY_PUBLISHED=true` 后重新部署。最后把真实 URL 写入 README 和 Release Notes。

Vercel 的池化运行时连接符合 Serverless 并发场景；Neon 官方同样建议迁移使用直连地址。参考 [Neon Connection Pooling](https://neon.com/docs/connect/connection-pooling) 和 [Vercel Environment Variables](https://vercel.com/docs/environment-variables)。

## 必填环境变量

两种模式都必须配置 `APP_DEPLOYMENT_MODE`、`DATABASE_URL` 和 `SITE_URL`。生产 `DATABASE_URL` 必须包含 `sslmode=require` 或 `sslmode=verify-full`。Serverless Web 优先使用池化地址，依赖 session advisory lock 的迁移使用直连地址。full Web 另外必须配置不同的 `CRON_SECRET`、`ADMIN_SECRET`；showcase 不需要这两个密钥，即使配置也不会开放写入口。

可选的 `PUBLIC_REPOSITORY_URL` 和 `PUBLIC_REPOSITORY_PUBLISHED` 只用于首页开源状态，不是 Secret。可以先登记计划地址，但 Private 阶段必须保持 `PUBLIC_REPOSITORY_PUBLISHED=false`；完成公开前安全门禁并实际切换为 Public 后，才把它设为 `true`，此时首页才显示真实链接。

任何 Web 都不应持有 `GITHUB_TOKEN` 或 `DEEPSEEK_API_KEY`；showcase 预检发现这两个变量会直接失败。full Web 只负责鉴权、入队和状态查询，Web 与 Worker 都应配置相同的 `DEEPSEEK_PRO_MODEL`，保证缓存身份一致；只有 full 的独立 Worker 注入 DeepSeek 密钥。Migration 进程需要 `APP_DEPLOYMENT_MODE` 和 `DATABASE_URL`。

Worker 可选调优变量：

- `RADAR_WORKER_POLL_MS`：常驻 Worker 的轮询间隔，默认 5000。
- `RADAR_JOB_STALE_AFTER_MS`：心跳过期阈值，默认 300000。
- `RADAR_QUEUE_DEGRADED_AFTER_MS`：最老可领取雷达任务的健康降级阈值，默认 600000。
- `STUDY_PLAN_AI_TIMEOUT_MS`：Pro 单次完整方案超时，默认 300000，可配置到 600000。
- `STUDY_PLAN_JOB_STALE_AFTER_MS`：学习方案任务过期阈值，默认 600000。
- `STUDY_PLAN_QUEUE_DEGRADED_AFTER_MS`：最老可领取学习方案任务的健康降级阈值，默认 1800000。

数据保留变量使用 `.env.example` 中的 `RETENTION_*` 默认值。生产环境应至少每周先运行一次 `pnpm data:retention` 检查报告，再在备份正常时执行确认后的 apply 命令。

本地开发未配置 DeepSeek 时仍可观察规则 fallback；但 `APP_DEPLOYMENT_MODE=full` 代表可生成完整方案的生产自部署，Worker 预检要求 DeepSeek Key，避免雷达看似可用而 Pro 方案必然失败。Full Worker 配置：

- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`
- `DEEPSEEK_FLASH_MODEL`：候选简介、学习价值和 Mini 范围，默认 `deepseek-v4-flash`
- `DEEPSEEK_PRO_MODEL`：按需生成具体学习方案，默认 `deepseek-v4-pro`

完整变量和默认值见 `.env.example`。

## 可移植容器基线

仓库提供同一个 `Dockerfile` 的两个生产 target：

```bash
docker build --target web -t github-learning-radar-web .
docker build --target worker -t github-learning-radar-worker .
```

- `web` 使用 Next.js standalone 输出，只运行 `server.js`，监听 `3000`，并以非 root `node` 用户运行。
- `worker` 只安装生产依赖并运行 `pnpm worker:radar`，同样以非 root 用户运行。
- 两个容器都会先执行对应的 `production:check` 规则；配置不完整时进程直接失败，不会以本地 JSON 或缺密钥状态假装成功。
- Web 与 Worker 必须使用相同的 `DATABASE_URL` 和业务配置；`GITHUB_TOKEN`、`DEEPSEEK_API_KEY`、管理员密钥只在需要它们的进程中通过部署平台 Secret 注入，不能写进镜像。
- 发布迁移可用 Worker 镜像临时执行 `pnpm db:migrate`；迁移 advisory lock 会串行化竞争进程，逐文件 SHA-256 会拒绝已应用迁移被改写。迁移成功后再启动新版 Web 与 Worker。
- Web 健康检查把 `200` 和可解释的 `503 degraded` 都视为进程可达；负载均衡和发布门禁仍必须读取响应体，并要求正式环境最终达到 `status: ok`、`storage: postgres`。

`.dockerignore` 会排除本地环境变量、数据、构建缓存、Git 元数据和常见私钥文件。生产平台仍应启用镜像扫描、只读根文件系统（平台支持时）、资源限制和滚动回滚。

## 隔离 PostgreSQL 集成验证

`compose.integration.yml` 只用于本机或 CI 的临时数据库，里面的固定账号和密码不能用于部署。它不会传入 GitHub Token 或 DeepSeek Key，因此不会访问 GitHub、DeepSeek 或消耗模型 Token。

```bash
docker compose -f compose.integration.yml build migrate integration
docker compose -f compose.integration.yml up -d --wait postgres
docker compose -f compose.integration.yml run --rm migrate
docker compose -f compose.integration.yml run --rm integration
docker compose -f compose.integration.yml down --volumes --remove-orphans
```

集成命令只有在 `ALLOW_POSTGRES_INTEGRATION_TEST=1` 且数据库名包含 `test` 或 `integration` 时才允许运行。它创建带唯一前缀的临时数据，验证迁移版本、雷达事务与规范化投影、详细方案缓存和多 Worker 原子领取，随后在事务中清理夹具。即便脚本有自动清理，也只能连接专用测试数据库，不能把该确认开关设置在生产环境。

## 发布顺序

showcase 发布只部署 Web：先准备只读展示所需的 PostgreSQL 数据，设置 `APP_DEPLOYMENT_MODE=showcase`，运行 Migration/Web 预检与迁移，再执行完整本地门禁和 showcase HTTP 回归。不要创建 Worker 服务、GitHub/DeepSeek Secret 或外部 Cron；发布后应确认三个写入口均返回 `403 showcase_read_only` 且 `job_runs` 数量不变。

full 自部署按以下顺序：

1. 创建 PostgreSQL，并使用只授予应用所需权限的账号。
2. 设置 `APP_DEPLOYMENT_MODE=full` 和其余生产环境变量。
3. 执行 `pnpm install --frozen-lockfile`。
4. 对 Web、Worker、Migration 分别运行 `pnpm production:check -- --profile=<profile>`。
5. 执行 `pnpm db:migrate:production`。
6. 执行 `pnpm db:rebuild-radar-projections`，为历史 `radar_runs` 重建规范化投影。
7. 在专用测试库执行上述 PostgreSQL 集成验证；没有 Docker 时，显式设置确认开关后运行 `pnpm db:integration`。
8. 执行 `pnpm typecheck && pnpm verify && pnpm build`。
9. 部署应用。
10. 检查 `GET /api/health` 返回 `storage: postgres`，并确认 `taskQueue.staleRunning` 为 0。
11. 将 `pnpm worker:radar` 部署为独立进程并确认持续运行；无常驻进程能力的平台使用 `pnpm worker:radar:once` 定期领取。
12. 配置 Cron，并确认错误告警和日志保留策略。
13. 配置每周数据保留 dry-run/告警；apply 必须保留显式确认参数，并确保数据库备份可用。

回滚必须保持模式边界：showcase 只能回滚到同样支持 `APP_DEPLOYMENT_MODE=showcase` 和四入口拒绝的已验证镜像；没有安全旧镜像时先关闭公网入口或切维护页，不能带流量回滚。full 先暂停 Cron、再停止 Worker，然后回滚 Web/Worker；确认 schema 向前兼容后恢复 Worker，最后恢复 Cron。

详细的暂停 Worker、备份、应用回滚、数据库恢复和故障演练步骤见 [OPERATIONS.md](./OPERATIONS.md)。

## 发布后检查

- 首页只显示公开运行状态，不显示密钥配置细节。
- showcase 的学习方案 POST/DELETE、雷达刷新 POST 和 Cron GET 均返回 `403 showcase_read_only`，且不新增任务；full 未授权调用手动刷新或强制生成返回 `401`。
- 两个独立浏览器会话的偏好、收藏和反馈互不影响，请求体伪造 `userId` 不会改变写入身份。
- `glr_session` Cookie 包含 `HttpOnly`、`SameSite=Lax`，生产环境还必须包含 `Secure`。
- 匿名令牌包含版本与签发时间、固定一年失效；服务端只续活已登记且未过期的记录，清除数据后的旧 Cookie 重放返回 401。
- 创建一组已过期和一组正在续活的测试会话，确认批量清理只删除过期匿名记录并级联清理学习进度，不删除续活记录或历史非匿名兼容记录。
- 设置页“清除我的数据”能删除当前匿名会话数据且不影响其他会话。
- 同一匿名 Cookie 在刷新页面后能恢复学习步骤；接口离线时本机点亮状态保留，恢复联网后按逐步骤更新时间合并。
- 详细方案重复请求命中缓存，频繁请求返回 `429`。
- Cron 重复触发不会产生重复最终数据。
- 数据库、GitHub 和 DeepSeek 任一失败时，页面仍能显示可解释状态。
- 历史页能看到 DeepSeek 调用成功/fallback 数和 Token 用量；provider 未返回用量时显示 0，不做费用猜测。
- 健康检查能报告任务堆积、过期运行和最近成功时间。
