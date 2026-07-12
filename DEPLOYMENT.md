# 部署指南

## 推荐架构

生产环境应保持 Next.js 应用无状态：

```text
Browser → Next.js Web/API → PostgreSQL
                         ↘ GitHub API
                         ↘ DeepSeek
Cron/Admin → 受保护刷新入口 → PostgreSQL 任务队列 → 独立 Worker（4.3）
```

当前 Web/API 已改为快速创建持久化任务并返回 `202`，不再在触发请求中等待 GitHub 和 DeepSeek。开发环境会自动执行已入队任务，便于本地使用；生产环境必须另行启动 `pnpm worker:radar`（或由任务平台反复调用 `pnpm worker:radar:once`），否则任务会保持 `queued`。`POST /api/radar/refresh` 仍只允许管理员调用。

用户偏好、收藏和反馈已按 HttpOnly 匿名会话隔离，公共雷达结果仍为全站共享。匿名 Cookie 丢失后无法恢复原数据；若未来需要跨浏览器身份恢复，再接入正式登录和账号绑定。

## 必填环境变量

- `DATABASE_URL`
- `CRON_SECRET`
- `ADMIN_SECRET`
- `SITE_URL`

Web 不应持有 `GITHUB_TOKEN`；它只负责鉴权和入队。独立 Worker 必须配置 `DATABASE_URL`、`GITHUB_TOKEN`，DeepSeek 配置按需注入。Migration 进程只需要 `DATABASE_URL`。完整进程权限矩阵见 [OPERATIONS.md](./OPERATIONS.md)。

Worker 可选调优变量：

- `RADAR_WORKER_POLL_MS`：常驻 Worker 的轮询间隔，默认 5000。
- `RADAR_JOB_STALE_AFTER_MS`：心跳过期阈值，默认 300000。

数据保留变量使用 `.env.example` 中的 `RETENTION_*` 默认值。生产环境应至少每周先运行一次 `pnpm data:retention` 检查报告，再在备份正常时执行确认后的 apply 命令。

DeepSeek 为可选增强；不配置时系统使用规则 fallback。启用时配置：

- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`

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
- 发布迁移可用 Worker 镜像临时执行 `pnpm db:migrate`；迁移成功后再启动新版 Web 与 Worker。
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

1. 创建 PostgreSQL，并使用只授予应用所需权限的账号。
2. 设置生产环境变量。
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

详细的暂停 Worker、备份、应用回滚、数据库恢复和故障演练步骤见 [OPERATIONS.md](./OPERATIONS.md)。

## 发布后检查

- 首页只显示公开运行状态，不显示密钥配置细节。
- 未授权调用手动刷新接口返回 `401`。
- 两个独立浏览器会话的偏好、收藏和反馈互不影响，请求体伪造 `userId` 不会改变写入身份。
- `glr_session` Cookie 包含 `HttpOnly`、`SameSite=Lax`，生产环境还必须包含 `Secure`。
- 设置页“清除我的数据”能删除当前匿名会话数据且不影响其他会话。
- 同一匿名 Cookie 在刷新页面后能恢复学习步骤；接口离线时本机点亮状态保留，恢复联网后按逐步骤更新时间合并。
- 详细方案重复请求命中缓存，频繁请求返回 `429`。
- Cron 重复触发不会产生重复最终数据。
- 数据库、GitHub 和 DeepSeek 任一失败时，页面仍能显示可解释状态。
- 历史页能看到 DeepSeek 调用成功/fallback 数和 Token 用量；provider 未返回用量时显示 0，不做费用猜测。
- 健康检查能报告任务堆积、过期运行和最近成功时间。
