# 发布就绪证据矩阵

本文件记录“当前已经由证据证明什么”，并把代码存在、自动化已配置、当前机器已通过、真实生产已通过四种状态分开。没有真实运行证据的项目不能标为完成。

## 当前工作区已证明

| 门禁 | 当前证据 | 结论 |
| --- | --- | --- |
| TypeScript | `tsc --noEmit` 成功 | 通过 |
| 逻辑与安全规则 | `scripts/verify.ts` 成功，覆盖评分、缓存、会话、任务、保留、生产预检和最小权限规则 | 通过 |
| Git 跟踪审计 | Git 2.55.0.windows.2、本地 `main`、GitHub noreply 作者、153 个受审计文件和首个提交 `7a188bd`；`git diff --cached --check` 与严格仓库卫生通过 | 通过（尚未推送） |
| 仓库静态卫生 | `.env.local`、`.data`、依赖、构建、日志和私钥被忽略；`.env.example` 密钥为空；`.gitattributes` 固定跨平台 LF/二进制图片 | 通过 |
| standalone 构建 | Next.js 生产构建成功，产物含 server、public、static 和生产预检 | 通过 |
| 生产 HTTP | 首页、主要页面、404、Cookie、健康、学习方案入口等回归成功 | 通过 |
| 运行时域名 | 构建后注入临时 `SITE_URL`，首页 canonical、sitemap、robots 均使用运行时域名 | 通过 |
| DeepSeek fallback | 未配置/失败时规则 fallback、调用轨迹和 Token 处理已有自动化测试 | 通过（无真实模型调用） |
| PostgreSQL 防误操作 | 集成脚本需要显式确认并限制测试数据库名；无确认时在连接前拒绝 | 通过 |
| 真实浏览器（部分） | 内置浏览器已恢复；390/768/1440 首页、404、规则学习方案、步骤刷新保持、焦点环和控制台已实跑，截图位于 `artifacts/release-readiness/browser-6.4/` | 条件通过；键盘事件、屏幕阅读器、断网和独立双会话仍待补 |

这些证据不能替代下表的真实工具、浏览器、数据库和云资源验证。

## 尚缺外部证据

| 发布门禁 | 当前状态 | 需要的权威证据 | 恢复条件/入口 |
| --- | --- | --- | --- |
| 真实浏览器 6.4 | 运行时已恢复；390/768/1440、移动/桌面导航、404、规则方案、步骤刷新保持、焦点环和无控制台错误已通过。自动化 Tab/Enter 未产生原生事件，新标签页共享同一 Cookie 上下文 | 实际 Tab/Enter/Space 与屏幕阅读器、断网恢复、两套独立浏览器 Cookie 隔离证据 | 使用可注入真实键盘事件且支持第二隔离上下文的浏览器，或由维护者完成人工回归；不重复已通过的截图/布局检查 |
| Docker 镜像 | 当前系统无 Docker | Web/Worker target 构建日志、非 root 进程、镜像内容和健康检查 | Docker 或 GitHub Actions 的 `container-integration` |
| 真实 PostgreSQL | 当前系统无 Docker、`psql`、`DATABASE_URL` | 迁移 0001–0013、事务投影、并发领取、投影重建、保留 dry-run | 隔离测试库运行 `compose.integration.yml` 与数据库命令 |
| GitHub 仓库设置 | 维护者已创建 Private 仓库 `lxy968/github-learning-radar`，但本地尚未添加 remote 或推送 | 首次推送、CI 结果、分支保护、Required CI、Dependabot、Secret Scanning、Issue/PR 模板页面 | 维护者再次确认后添加 `origin` 并推送 `main`，仓库继续保持 Private |
| GitHub discovery smoke | 普通 CI 不调用外部 API | 受控调用次数、限流、耗时、候选数量和脱敏日志 | 在预览 Worker 使用最小权限 Token 手动运行一次 |
| DeepSeek smoke | 为避免费用未执行 | provider、模型、耗时、成功/fallback 和 provider 返回 Token | 受控环境运行一次 `pnpm ai:smoke`；不进入普通 CI |
| 预发布部署 | 平台、PostgreSQL、域名和 Secret 未确定 | HTTPS 站点、Web/Worker/Cron、`status: ok`/`storage: postgres` | 选择平台后执行 `DEPLOYMENT.md` 与 `OPERATIONS.md` |
| 备份与回滚 | 没有真实数据库和镜像仓库 | 可恢复备份、镜像 digest 回滚、任务恢复和脱敏演练记录 | 预发布环境执行一次完整演练 |
| 正式发布资料 | 没有真实 URL、截图、commit/tag | 仓库/Demo 链接、产品截图、commit、`v0.1.0` tag 和 Release | 上述门禁通过后更新 Release Notes |

## 恢复顺序

1. 先恢复 Git/GitHub 环境，执行严格仓库门禁并触发 CI。
2. 用 CI 或本机 Docker 完成镜像与 PostgreSQL 集成；失败时先修 8.3，不进入云部署。
3. 恢复真实浏览器，完成 6.4 多视口、键盘和双会话回归。
4. 选择预发布平台、数据库和域名，按 `OPERATIONS.md` 完成最小权限、迁移、健康、Worker/Cron、备份与回滚。
5. 最后执行受控 GitHub/DeepSeek smoke，补真实截图、URL、tag 和 Release。

任何一次继续开发前，先核对本矩阵和 `ROADMAP.md` 的“当前下一步”；若外部条件没有变化，不重复运行同一个已知失败的环境门禁。
