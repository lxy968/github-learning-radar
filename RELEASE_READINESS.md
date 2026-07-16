# 发布就绪证据矩阵

本文件记录“当前已经由证据证明什么”，并把代码存在、自动化已配置、当前机器已通过、真实生产已通过四种状态分开。没有真实运行证据的项目不能标为完成。

## 当前工作区已证明

| 门禁 | 当前证据 | 结论 |
| --- | --- | --- |
| TypeScript | `tsc --noEmit` 成功 | 通过 |
| 逻辑与安全规则 | `scripts/verify.ts` 成功，覆盖评分、缓存、会话、任务、保留、生产预检和最小权限规则 | 通过 |
| Git 跟踪审计 | Git 2.55.0.windows.2、本地 `main`、GitHub noreply 作者、首个提交 `7a188bd`；线上 3/7/14 天功能修复提交为 `0a36840`；严格仓库卫生与 `git diff --check` 通过 | 通过；功能修复对应的 GitHub Actions CI #21 成功 |
| 仓库静态卫生 | `.env.local`、`.data`、依赖、构建、日志和私钥被忽略；`.env.example` 密钥为空；`.gitattributes` 固定跨平台 LF/二进制图片 | 通过 |
| standalone 构建 | Next.js 生产构建成功，产物含 server、public、static 和生产预检 | 通过 |
| 生产 HTTP | 首页、主要页面、404、Cookie、健康、学习方案入口等回归成功 | 通过 |
| 运行时域名 | 构建后注入临时 `SITE_URL`，首页 canonical、sitemap、robots 均使用运行时域名 | 通过 |
| DeepSeek fallback | 未配置/失败时规则 fallback、调用轨迹和 Token 处理已有自动化测试 | 通过（无真实模型调用） |
| 内容质量与模型分工（第一阶段） | Flash 按学习水平调整语言，默认首页展示 7 项且 7 项都尝试 Flash；Pro 对 3/7/14 天使用一次完整后台生成，默认 300 秒、最大可配置 600 秒，项目不设置额外输出 Token 上限；三张卡片严格串行但轮询不抢占用户当前查看状态；Windows 本地任务文件写入具备锁冲突重试和回退；模型 JSON 支持围栏/前后文字提取及超量字段安全收敛；Web 不持有 DeepSeek 密钥，迁移 0014 提供数据库级活跃任务唯一约束；模拟慢响应、并发入队和一次完整保存已通过 | 类型/逻辑/卫生/构建/HTTP 已通过；受控首页刷新 7/7 Flash 成功，3/7/14 天 Pro 方案均已真实完整生成并进入只读展示缓存 |
| 候选学习入口与界面配置隔离 | 已保存候选无需进入今日推荐即可打开 3/7/14 天方案页；学习方案 API、后台任务和缓存都能解析候选仓库。用户界面不显示 Flash、Pro、供应商或模型 ID，只说明智能分析、智能生成与内置规则；底层仍只接受既定 DeepSeek 配置。重复的“项目库”已并入候选项目，旧地址保留兼容跳转 | 类型/逻辑/卫生/构建通过；生产 HTTP 确认候选详情、方案页、任务 `202` 入队和旧地址跳转，Worker 未运行、无真实模型调用 |
| 线上作品集说明（内容层） | 首页按“项目问题 → 所有人两分钟体验 → 完整流程 → 工程取舍 → Token 防护 → Showcase/自部署差异 → GitHub/Fork/Key/部署 → 测试证据”组织；详细工程说明默认折叠。可选 `PUBLIC_REPOSITORY_URL` 只接受安全的 GitHub 仓库 URL，未公开时显示“开源准备中” | 类型、逻辑、严格卫生、构建和生产 HTTP 回归通过；成本防火墙与预置完整方案闭环均已完成，真实线上证据见外部门禁 |
| Showcase 服务端零入队边界 | `APP_DEPLOYMENT_MODE` 明确区分 showcase/full；生产漏配或无效时运行时 fail-closed，`.env.example` 安全默认 showcase。showcase 在会话/数据库写入前拒绝学习方案生成/取消、雷达刷新和 Cron，内部入队、执行、取消与 Worker 另有断言；provider 即使误注入 Key 也不返回模型，AI smoke 拒绝运行。生产预检禁止 showcase 持有 GitHub/DeepSeek Key 或启动 Worker。full 匿名访客在任何 NODE_ENV 都不能使用 `force=true`，仅管理员 Bearer 可强制重生成。showcase 页面和上游入口只使用“预置/可体验/准备中”，不再显示禁用生成按钮或承诺不可执行的现场生成 | 类型、逻辑、严格卫生、`git diff --check`、生产构建和 CI #21 通过；真实 Vercel URL 确认生成、刷新与 Cron 返回 `403 showcase_read_only`，访问前后两类任务队列保持为零；Vercel 未配置 GitHub/DeepSeek/OpenAI/Admin/Cron Secret，未部署 Worker |
| Showcase 内置方案与进度闭环 | 当前推荐在 showcase 中获得同一仓库真实 DeepSeek Pro 缓存的 3/7/14 天完整方案；三个周期都有稳定 ID，不写方案表。内部 fixture 保留模型、调用轨迹和 Token 证据，公开接口会剥离这些元数据，只返回学习内容；步骤进度仍按匿名会话写入允许的进度存储 | 逻辑、隔离生产与真实 Vercel HTTP 都完成“读取三个方案 → PUT 第一步 → 再读相同 ID → GET 恢复完成态”，并确认公开 JSON 不含内部模型 ID、调用轨迹或 Token。Neon 健康为 `ok/postgres`，访问前后任务队列保持为零 |
| 会话、反馈与任务所有权收口 | 匿名令牌带签发时间并固定一年失效，Proxy 首次登记、后续只续活有效记录；清除/过期令牌不能重建原身份。过期清理按批执行并在 PostgreSQL 使用匿名 ID 过滤、跳锁和最终过期复核。Feedback 使用字段/媒体类型/字节/UTF-8 白名单，任务状态默认按当前会话所有权拒绝。项目尚未公开上线，首发直接重置旧格式本地开发 Cookie，不承担线上用户迁移 | 类型、逻辑、严格卫生、差异、生产构建和 full/showcase HTTP 回归通过；覆盖删除令牌重放、25 条跨批清理、反馈边界/异常流、跨会话与畸形任务 ID。PostgreSQL 续期锁竞态、四类子表级联和非匿名保护已加入 `container-integration`，远程实跑待提交后确认 |
| Worker/队列/迁移可靠性 | 两类任务在持续积压时交替优先，空队列立即回退；健康摘要区分延迟重试与可领取任务，并对两类队列报告 stale、数量和等待超时原因。迁移使用跨进程 advisory lock、同 reserved 会话显式事务和逐文件 SHA-256；生产数据库 URL 强制 TLS 模式 | `7597a55` 真实 CI 暴露的 reserved 连接问题已由 `3ef391e` 改为显式 `BEGIN/COMMIT/ROLLBACK` 并推送；本次未提交改动的远程 CI 仍待推送后确认 |
| 首页来源、开源状态与基础无障碍 | 首页与候选池的 seed 快照明确标为演示且不代表当天热度/实时 discovery，只有 GitHub 来源显示“今日/近期”；开源链接要求合法 URL 与显式 published 状态同时成立；新增跳过导航、焦点目标、单一 main 地标和装饰图标隐藏 | 类型、逻辑、严格卫生、差异、生产构建和 full/showcase HTTP 回归通过；showcase 生产浏览器真实点击首页→详情→方案→完成一步，刷新后恢复 `1/6` 且无控制台 warning/error。Tab/Enter/Space 注入仍无原生焦点变化，NVDA 与独立 Cookie 上下文未完成，不能标为人工无障碍通过 |
| 完整 Git 历史与依赖安全 | 新命令枚举所有 refs 的历史 blob，拒绝历史环境文件、数据库、私钥、本地数据、构建目录和疑似 Token；输出不包含匹配内容。release check 与完整克隆 CI 均已接入。生产依赖审计发现 Next 传递的 PostCSS 中危 XSS 后，已定向覆盖到修复版 8.5.16 | 本地完整历史文本扫描通过；锁文件已固定 Next 使用 PostCSS 8.5.16，联网 `pnpm audit --prod --audit-level moderate` 返回 `No known vulnerabilities found`；类型、逻辑、严格卫生、差异、生产构建、线上 HTTP 与 CI #21 通过。GitHub Secret Scanning 等远端能力仍待公开后按可用性配置 |
| 零付费 Showcase 部署配置 | 使用 Vercel Hobby + Neon Free；版本化 `vercel.json` 强制 Web 生产预检后再构建且不含 env/cron。运行时用 Neon 池化 URL，迁移用直连 URL；公开 Web 不配置任何 GitHub/DeepSeek/OpenAI/Admin/Cron Secret | 官方免费规则于 2026-07-16 核对；Neon 迁移完成，真实 URL `https://github-learning-radar-lxy968.vercel.app` 为 `Ready/Current`，健康为 `ok/postgres`，真实线上 HTTP 回归和零任务队列检查通过 |
| PostgreSQL 防误操作 | 集成脚本需要显式确认并限制测试数据库名；无确认时在连接前拒绝 | 通过 |
| 真实浏览器（部分） | 内置浏览器已恢复；390/768/1440 首页、404、规则学习方案、步骤刷新保持、焦点环和控制台已实跑，截图位于 `artifacts/release-readiness/browser-6.4/` | 条件通过；键盘事件、屏幕阅读器、断网和独立双会话仍待补 |
| GitHub CI | Private 仓库线上功能修复提交 `0a36840` 的 CI #21 整体成功 | 通过；包含 Web/Worker 镜像、PostgreSQL 16 迁移与集成测试 |
| CI Actions 运行时维护 | 工作流已升级为 `actions/checkout@v7`、`actions/setup-node@v6`、`pnpm/action-setup@v4.4.0`；仓库卫生固定检查版本；清空 AI 密钥后的类型、逻辑、卫生、构建与 full/showcase 两套独立 HTTP 回归均已配置 | 本地双模式 standalone 与远程 CI #21 均通过 |
| Docker/PostgreSQL 集成 | GitHub Actions 构建 Web/Worker 镜像，启动 PostgreSQL 16，完成迁移、事务投影/缓存/并发领取集成和清理；未注入 GitHub/DeepSeek Secret | 通过（CI 环境） |

这些证据不能替代下表的真实工具、浏览器、数据库和云资源验证。

## 尚缺外部证据

| 发布门禁 | 当前状态 | 需要的权威证据 | 恢复条件/入口 |
| --- | --- | --- | --- |
| 真实浏览器 6.4 | 运行时已恢复；390/768/1440、移动/桌面导航、404、学习方案、步骤刷新保持、焦点环和无控制台错误已通过。自动化 Tab/Enter 未产生原生事件，新标签页共享同一 Cookie 上下文 | 实际 Tab/Enter/Space 与屏幕阅读器、断网恢复、两套独立浏览器 Cookie 隔离证据 | 使用可注入真实键盘事件且支持第二隔离上下文的浏览器，或由维护者完成人工回归；不重复已通过的截图/布局检查 |
| 线上作品集真实零 Token 证据 | 真实 Vercel + Neon 已完成全新会话内置完整方案、步骤保存/恢复和健康摘要检查；`status: ok`、`storage: postgres`，雷达与学习方案队列在访问前后均为零 | Vercel 只配置五个 showcase 变量，不含 GitHub/DeepSeek/OpenAI/Admin/Cron Secret；真实线上回归确认写任务入口全部拒绝 | 通过；后续若改变运行模式或环境变量需重新验收 |
| GitHub 仓库设置 | Private 仓库的线上功能修复 `0a36840` 已通过 CI #21；Dependabot 已运行，公开状态与适用安全设置仍待最终确认 | Public 可访问、默认分支与 CI 正常、Secret Scanning/Private Vulnerability Reporting 等可用能力已核对 | 维护者明确确认后切换为 Public，再设置 `PUBLIC_REPOSITORY_PUBLISHED=true` 并复测 |
| GitHub discovery smoke | 普通 CI 不调用外部 API | 受控调用次数、限流、耗时、候选数量和脱敏日志 | 在预览 Worker 使用最小权限 Token 手动运行一次 |
| DeepSeek smoke | Flash 受控刷新最终 7/7 成功并记录 Token；当前入库的 `deepseek-v4-pro` 展示缓存中，3 天、7 天、14 天方案分别完整生成，总 Token 为 7,153、12,101、9,832 | 三个周期的结构、天数、步骤和成功调用轨迹均由自动化验证；公开响应会剥离模型和 Token 元数据 | 不再重复消耗 Token；普通 CI 和公开 showcase 始终禁用真实 AI，只在维护者明确授权的 full 环境中允许新调用 |
| 预发布部署 | Vercel Hobby + Neon Free 已创建并部署，免费 HTTPS 域名为 `https://github-learning-radar-lxy968.vercel.app` | 迁移成功、`status: ok`/`storage: postgres`，无 Worker/Cron/模型 Key，功能基线 `0a36840` 已验证为 Ready/Current | 通过；公开仓库后再做最终复测 |
| 备份与回滚 | 没有真实数据库和镜像仓库 | 可恢复备份、镜像 digest 回滚、任务恢复和脱敏演练记录 | 预发布环境执行一次完整演练 |
| 正式发布资料 | 已有真实 Demo URL、浏览器截图和上线提交 `0a36840`；尚无 Public 仓库、`v0.1.0` tag 和 GitHub Release | Public 仓库、最终截图、tag 和 Release | 公开验收后更新 Release Notes 并创建正式版本 |

## 恢复顺序

1. Git/GitHub、严格仓库门禁与真实 CI 已完成；继续保留 `main` 保护规则配置。
2. GitHub Actions Docker/PostgreSQL 集成已完成；本机 Docker 复跑为可选补充证据。
3. 会话/反馈/任务所有权本地安全收口已完成；下一次远程 CI 需确认新增 PostgreSQL 续期/清理竞态测试。
4. Worker 队列健康/公平调度、迁移锁/校验和和 PostgreSQL TLS 本地基线已完成；下一次远程 CI 确认新增 SQL 场景。
5. 完成全 Git 历史扫描实跑；首页/候选来源、公开状态和基础无障碍已收口，6.4 仍需实际键盘、屏幕阅读器、断网和独立双会话人工证据。
6. Vercel Hobby + Neon Free 已完成最小权限部署、迁移、健康与线上回归；下一步由维护者确认仓库公开，然后补备份/回滚演练、最终截图、tag 和 Release。

任何一次继续开发前，先核对本矩阵和 `ROADMAP.md` 的“当前下一步”；若外部条件没有变化，不重复运行同一个已知失败的环境门禁。
