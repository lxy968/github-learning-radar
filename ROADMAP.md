# GitHub 学习雷达推进路线

> 更新时间：2026-07-12
> 用途：作为后续模型和开发者的单一推进依据。开始新阶段前先阅读本文，不要仅凭文件存在判断功能完成。

## 一、产品目标

把 GitHub 开源仓库转化为可执行的学习闭环：

```text
发现候选 → 规则评分 → 推荐理由 → Mini 复刻范围 → 具体学习方案 → 步骤完成进度
```

核心差异化不是“推荐 GitHub 项目”，而是“把真实仓库变成有操作、有依据、有验证标准和交付物的学习任务”。

## 二、当前状态

### 已完成

- GitHub 多查询候选发现，查询使用最近 120 天滚动窗口。
- README、语言和根目录信号 enrichment，部分查询失败时允许部分成功。
- 候选池、候选详情、当前雷达、项目详情和历史记录页面。
- 五维规则评分、兴趣偏好、反馈、收藏和规则 fallback。
- DeepSeek OpenAI-compatible 分析入口、超时、批次熔断和调用数量限制。
- 刷新状态跨页面保持，刷新阶段和进度可查询。
- 具体学习方案独立页面，支持 3/7/14 天、圆圈点亮、进度保存和 Markdown 复制。
- 具体学习方案按需生成，缓存命中不重复调用 AI；AI 失败时使用仓库相关规则方案。
- README HTML 与历史残缺标签清洗。
- 生产环境手动刷新使用 `ADMIN_SECRET` 保护。
- 详细方案生成限流、错误脱敏和全局成本保护。
- 本地 JSON fallback，以及仓库、运行记录、偏好、反馈和详细方案的 PostgreSQL 基础。
- 健康检查、robots、sitemap、安全响应头、加载、错误和 404 页面。
- CI、Dependabot、MIT License、贡献指南、安全政策、Issue/PR 模板和部署文档。
- 持久化任务模型：幂等创建、queued/running/终态、阶段、进度、尝试次数、心跳、错误摘要和状态查询 API。
- 后台 Worker：原子领取、心跳、过期恢复、持久化退避重试和终态幂等。
- 运行可观察性：错误分类、候选/AI/fallback/Token 指标、历史页指标和健康检查队列概览。
- HttpOnly 匿名会话：偏好、反馈和收藏按哈希身份隔离，支持清除数据，不信任客户端 `userId`。

### 已验证

- `pnpm verify` 对应的脚本验证通过。
- TypeScript 无错误。
- Next.js 生产构建通过。
- `/api/health`、`robots.txt`、`sitemap.xml` 和主要页面可返回正常状态。
- 本地没有 `DATABASE_URL`，因此新增 PostgreSQL 迁移尚未在真实数据库执行。

### 当前明确限制

- 匿名会话依赖浏览器 Cookie；尚未提供账号登录、跨浏览器恢复或匿名数据合并。
- 手动刷新、Cron 和独立 Worker 已完成代码接线；实际部署仍必须单独配置并监控 Worker 进程，否则任务会停留在 `queued`。
- PostgreSQL 原子领取逻辑已通过本地并发语义测试，但本地没有真实 `DATABASE_URL`，尚未完成多进程 PostgreSQL 集成验证。
- `.data` 只适合本地和单机演示；生产环境必须使用 PostgreSQL。
- 学习进度已同步到匿名会话，但匿名 Cookie 仍是唯一恢复凭据；尚未提供登录后的跨浏览器账号同步。
- Git for Windows 2.55.0 已安装，本地 `main` 已有有效提交并推送到 Private 仓库 `lxy968/github-learning-radar`；远端 `main` 已核对与本地 `228010d` 完全一致，GitHub Actions 结果待确认。
- 内置页面控制近期连接失败；必要时使用自动测试和本地 HTTP 检查，但正式发布前仍要完成真实浏览器回归。

## 三、推进原则

后续工作必须遵守以下顺序和边界：

1. 先完成可靠性、安全和数据一致性，再增加新功能。
2. 生产环境的 Next.js Web/API 应尽量无状态。
3. 任何可能产生 GitHub 或 AI 成本的接口都必须有认证或限流、缓存、幂等和预算保护。
4. AI 只能使用传入的仓库证据；无法确认的文件必须标记为“需要先确认”。
5. 本地 JSON 是开发 fallback，不是生产主存储。
6. 新增 schema 必须同时更新类型、迁移、读写实现、测试和部署文档。
7. 不同时重做账号系统、后台任务和大规模 UI 改版；每一阶段单独完成并验证。
8. 不因页面或文件存在就宣称功能完成，必须有调用路径和验证证据。

## 四、下一阶段：后台任务与分布式一致性（P0）

这是下一次开发应优先执行的阶段。

### 4.1 定义持久化任务模型

**状态：已完成（2026-07-11）**

实现证据：

- `lib/job-runs.ts`：PostgreSQL/本地 JSON 双存储、幂等创建、原子 queued→running、进度、心跳和终态更新。
- `migrations/0006_persistent_job_runs.sql`：扩展 `job_runs` 并增加幂等、状态和心跳索引。
- `app/api/jobs/[runId]/route.ts`：按 runId 查询公开安全状态，不返回内部 payload。
- `scripts/verify.ts`：验证重复入队复用、磁盘持久化、阶段进度、心跳、错误脱敏和 API 查询。

注意：本地没有 `DATABASE_URL`，迁移文件已通过代码/构建检查，但仍需在真实 PostgreSQL 环境执行 `pnpm db:migrate`。

目标：把刷新任务从进程内 Promise 改为数据库可恢复状态。

实施内容：

- 扩展 `job_runs` 或新增专用任务表。
- 至少保存：`runId`、任务类型、状态、阶段、进度、尝试次数、错误摘要、创建时间、开始时间、完成时间、心跳时间。
- 状态建议：`queued`、`running`、`success`、`partial`、`failed`、`cancelled`。
- 为“同一天同一任务”增加唯一幂等键。
- 增加迁移和本地 JSON fallback，生产路径以 PostgreSQL 为准。

验收标准：

- 进程重启后仍能读取任务状态。
- 重复入队不会产生两条等价任务。
- 失败阶段和错误摘要可从 API 查询。

### 4.2 将刷新接口改为快速入队

**状态：已完成（2026-07-11）**

实现证据：

- `lib/radar-jobs.ts`：统一手动/Cron 入队、同日幂等复用、任务领取、阶段持久化和终态摘要。
- `lib/daily-radar.ts`：支持外部 `runId`、开始时间和阶段进度回调。
- `app/api/radar/refresh/route.ts`：POST 快速返回 `202`，GET 按 `runId` 读取数据库/本地任务状态。
- `app/api/cron/daily-radar/route.ts`：定时入口只做调度判断与入队，不等待完整流水线。
- `components/radar-refresh-button.tsx`：按持久化任务轮询 queued/running/终态，页面切换和刷新后可继续找回。
- `.github/workflows/daily-radar.yml`：触发请求超时从 120 秒降为 15 秒。
- `scripts/verify.ts`：验证接口 `202`、任务复用、阶段进度、终态和按 `runId` 查询。

下一步：执行 4.3，增加生产可部署的独立 Worker、原子领取、定期心跳和过期任务恢复。

涉及文件：

- `app/api/radar/refresh/route.ts`
- `app/api/cron/daily-radar/route.ts`
- `lib/daily-radar.ts`

实施内容：

- 手动刷新和 Cron 只创建任务并返回 `202 Accepted`。
- 返回 `runId`、状态查询地址和是否复用已有任务。
- 不在触发请求中等待 GitHub 抓取和 AI 分析结束。
- 前端继续轮询状态，但状态来源改为数据库。

验收标准：

- 触发接口在数秒内返回。
- GitHub Actions 不再需要等待 30–180 秒。
- 页面切换、刷新和服务重启后仍能看到同一任务进度。

### 4.3 增加 Worker 和分布式锁

**状态：已完成（2026-07-11）**

实现证据：

- `lib/job-runs.ts`：使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 原子领取最早 queued 任务；本地 fallback 使用串行原子变更。
- `lib/job-runs.ts`：过期心跳在未耗尽尝试次数时重新入队，耗尽后标记 failed。
- `lib/radar-worker.ts`：每轮先恢复过期任务，再原子领取并执行一个任务。
- `lib/radar-jobs.ts`：领取后执行、15 秒默认心跳、阶段进度和幂等终态；终态任务不会二次执行。
- `scripts/radar-worker.ts`：支持 `pnpm worker:radar` 常驻运行和 `pnpm worker:radar:once` 单次领取，并响应 SIGINT/SIGTERM。
- `scripts/verify.ts`：验证两个并发 Worker 只有一个执行、心跳推进、过期重试、最大次数失败和终态不重复执行。

下一步：执行 4.4，补错误分类、可恢复错误退避重试、运行指标和健康检查任务概览。

实施内容：

- 先实现一个独立 Worker 入口，可由部署平台任务、常驻进程或受保护命令调用。
- 使用 PostgreSQL advisory lock、唯一状态更新或 Redis 锁保证同一任务只有一个 Worker 执行。
- Worker 定期更新心跳和阶段进度。
- 超过阈值未更新心跳的任务可标记为失败或重新领取。
- 所有保存步骤保持幂等，重复执行不会重复写入反馈或最终结果。

验收标准：

- 两个并发 Worker 只能有一个成功领取同一任务。
- Worker 中途退出后任务可以被识别和恢复。
- 重复执行不会产生重复雷达结果。

### 4.4 增加失败策略与可观察性

**状态：已完成（2026-07-11）**

实现证据：

- `lib/operational-errors.ts`：统一分类 GitHub/AI/数据库/应用的认证、额度、限流、超时、服务端、网络和无效响应错误。
- `lib/job-runs.ts` 与 `migrations/0007_job_observability.sql`：持久化 `error_category`、`available_at`，只对可恢复错误做指数退避并延迟领取。
- `lib/ai/analyze.ts` 与 `lib/daily-radar.ts`：记录 AI 请求、成功、fallback、输入/输出/总 Token，以及候选和 GitHub 查询失败数。
- `lib/radar-runs.ts`：持久化运行 metrics；同一 runId 继续使用 upsert，重试不会重复最终记录。
- `app/api/health/route.ts`：报告 queued、running、staleRunning、oldestQueuedAt 和 lastSuccessfulAt，过期或明显堆积时降级。
- `app/history/page.tsx`：展示每次运行的 GitHub 查询、AI 成功/fallback 和 provider Token 指标。
- `scripts/verify.ts`：验证错误分类、只重试可恢复错误、退避可领取时间、用量聚合和健康检查安全概览。

下一步：后台任务阶段已完成。按第五节的既定公开模式推进 5.2，先实现不可预测的 HttpOnly 匿名会话，再隔离偏好、反馈、收藏和学习进度。

实施内容：

- GitHub 429/5xx、AI 超时、余额不足、数据库异常分别分类。
- 只对可恢复错误退避重试。
- 余额不足、认证失败等错误立即熔断，不重复消耗请求。
- 记录候选数、AI 调用数、fallback 数、耗时和 Token/费用（provider 返回时）。
- 健康检查增加任务堆积和最后成功运行时间，但不泄露密钥或内部错误详情。

验收标准：

- 每次任务都能说明成功、部分成功或失败的原因。
- 可以区分 GitHub、AI、数据库和代码错误。
- 不可恢复错误不会反复重试。

## 五、随后阶段：用户数据隔离（P0）

后台任务阶段完成后再开始。

### 5.1 先确定公开模式

推荐第一版采用：

- 雷达数据和推荐结果为全站公共内容。
- 全站刷新仅管理员或 Cron 可触发。
- 匿名用户偏好、收藏和进度使用独立匿名会话。
- 后续登录后再将匿名数据绑定到账号。

不要继续让公众共享 `demo-user`。

### 5.2 实现匿名会话或登录

**状态：已完成（2026-07-11），采用匿名会话方案**

实现证据：

- `proxy.ts` 与 `lib/anonymous-session.ts`：生成 256 位随机 Cookie，设置 HttpOnly/SameSite/Secure 策略，并只把 SHA-256 哈希身份交给服务端数据层。
- `migrations/0008_anonymous_sessions.sql`：增加匿名会话表、过期索引，以及偏好、交互和反馈的级联外键。
- `lib/preferences.ts` 与 `lib/user-state.ts`：PostgreSQL/本地 JSON 均按显式用户 ID 隔离，旧单用户本地数据只保留在不可自动继承的 legacy 命名空间。
- `app/api/preferences/route.ts`、`app/api/feedback/route.ts` 和 `app/api/bookmarks/route.ts`：身份只取自 Cookie，请求体无法覆盖，反馈响应不泄露内部用户 ID。
- `app/api/session/route.ts` 与 `components/anonymous-data-controls.tsx`：提供安全会话说明和当前匿名数据清除入口。
- `lib/preferences.ts` 与 `lib/daily-radar.ts`：公共雷达调度偏好和访客个性化偏好分离，访客设置只重排公共推荐，不控制全站 Cron。
- `scripts/verify.ts`：验证随机身份、Cookie 安全属性、双会话隔离、伪造 userId 无效、单会话删除不影响另一会话。
- 本地浏览器回归：设置页与首页正常加载，隐私说明和公共调度文案可见，控制台无错误。

实施内容：

- 使用不可预测的 HttpOnly 会话标识，或接入正式登录。
- `preferences`、`feedback`、`bookmarks` 和学习进度全部按用户 ID 读写。
- 服务端不能信任浏览器直接提交的任意 `userId`。
- 增加退出、数据清理和隐私说明。
- 对用户表和交互表增加必要索引与外键策略。

验收标准：

- 两个浏览器会话的偏好、收藏和反馈互不影响。
- 用户不能读取或覆盖另一个用户的数据。
- 未登录/匿名状态有明确的数据保存说明。

### 5.3 同步学习进度

**状态：已完成（2026-07-11）**

实现证据：

- `migrations/0009_learning_progress.sql`：增加 `(user_id, plan_id, step_id)` 主键、匿名会话级联外键和更新时间索引。
- `lib/learning-progress.ts`：PostgreSQL/本地 JSON 双存储，按步骤客户端更新时间合并；旧更新不能覆盖新更新，相同请求保持幂等。
- `app/api/progress/route.ts`：GET/PUT 只使用 HttpOnly 会话身份，限制 plan/step 长度、批量数量和写入频率。
- `lib/use-synced-progress.ts`：保留旧 localStorage 布尔格式，新增逐步骤时间戳；离线 optimistic 更新，联网和窗口恢复时自动合并。
- `components/detailed-study-plan-builder.tsx` 与 `components/learning-plan-section.tsx`：详细方案和旧版 3/7/14 天路线均显示同步/离线状态。
- `components/bookmarked-routes-board.tsx`：学习队列会先合并服务端进度，再按完成度排序，新设备不再只能看到空的本机状态。
- 数据清除会同时删除偏好、反馈、收藏、服务端进度和本机进度。
- `scripts/verify.ts`：验证双会话进度隔离、伪造 userId 无效、旧更新时间不覆盖新值和单会话删除级联。
- 本地浏览器回归：详细方案显示“已同步到匿名会话”，`/api/progress` 返回 200，控制台无错误。

下一步：进入 6.1 首页做减法，先重排信息层级和主操作，再执行 6.2 导航收敛与移动端适配。

- 将详细方案步骤完成状态从纯 `localStorage` 扩展到服务器。
- 离线或接口失败时保留本地 optimistic 状态。
- 冲突策略建议使用“最近更新时间”或逐步骤时间戳。
- 登录后可选择合并匿名进度。

## 六、产品与前端优化阶段（P1）

可靠性和用户隔离完成后再进行大改版。

### 6.1 首页做减法

**状态：已完成（2026-07-11）**

实现证据：

- `components/recommendation-card.tsx`：首屏只保留项目用途、两条核心推荐原因、难度/建议周期、Mini 复刻重点和主操作。
- 推荐卡主按钮直达具体学习方案，并根据是否已有方案显示“开始学习”或“继续学习”；项目详情、GitHub 和反馈降为次操作。
- 英文原始简介、完整推荐依据、学习标签和五维评分移动到原生 `<details>` 折叠区域，键盘仍可访问。
- `app/page.tsx`：四块统计压缩为三项摘要；普通首页只展示更新时间和数据完整性，候选数、AI fallback、抓取间隔等放入“运行与个性化详情”。
- `app/bookmarks/page.tsx`：收藏页复用相同主操作层级，并识别已有详细方案。
- `scripts/verify.ts`：组件级验证“开始/继续学习”、核心信息和折叠详情的顺序。
- 本地 HTTP 回归：首页返回 200，匿名 Cookie 安全属性、主操作、核心摘要、折叠详情和雷达状态均存在。
- `pnpm typecheck`、`pnpm verify` 和 `pnpm build` 通过。

限制：本轮内置浏览器连接因运行环境路径错误无法完成 390px/桌面截图；6.4 的真实多尺寸回归仍保持未完成，不能用构建通过替代。

下一步：执行 6.2，收敛普通用户导航并增加移动端抽屉或底部导航。

- 推荐卡首屏只保留：项目用途、为什么推荐、难度/预计投入、核心复刻点和主操作。
- 英文原始简介、五维分数和完整理由放入展开区域。
- 把运维信息移出普通首页，只显示“更新时间”和“数据完整性”。
- “开始学习/继续学习”作为主按钮，GitHub 和反馈作为次操作。

### 6.2 简化导航

**状态：已完成（2026-07-11）**

实现证据：

- `components/sidebar-nav.tsx`：普通主导航收敛为“今日推荐、我的学习、收藏、设置”。
- 候选项目、项目库和运行历史移动到带分组标题的“探索”区域；手机端通过顶部探索菜单访问。
- `/projects/*` 会激活“我的学习”，候选详情会激活“候选项目”，不再只按链接本身的路径判断。
- 手机端使用固定四项底部导航，单项最小高度 64px；`AppShell` 使用 `env(safe-area-inset-bottom)` 预留安全区域和正文底部空间。
- 桌面导航、移动导航和探索菜单均提供语义化 `nav`/`aria-label`/`aria-current`，原生探索 `<details>` 可键盘操作。
- `scripts/verify.ts`：验证四个主入口、三个探索入口和项目/候选子路径的激活规则。
- 本地 HTTP 回归：首页返回 200，同时输出桌面和移动导航语义、全部入口和底部安全间距类。
- `pnpm typecheck`、`pnpm verify` 和 `pnpm build` 通过。

限制：真实手机视口和屏幕阅读器操作仍属于 6.4，当前结构证据不能替代设备级回归。

下一步：执行 6.3，把详细学习方案改为专注模式。

普通用户主导航建议收敛为：

- 今日推荐
- 我的学习
- 收藏
- 设置

候选池、项目库和运行历史归入“探索”或管理员区域。移动端改为底部导航或抽屉菜单，避免横向滚动承担全部导航。

### 6.3 学习方案进入专注模式

**状态：已完成（2026-07-11）**

实现证据：

- `components/detailed-study-plan-builder.tsx`：根据同步进度定位第一个未完成步骤，并自动把其 Day 设为当前 Day。
- 总进度、百分比、当前 Day、当前任务和“完成并进入下一步”放入 `sticky` 专注栏；最后一步和全完成状态有独立文案。
- 同一时间只展开一个 Day；当前 Day 默认展开，已完成和未来 Day 默认折叠，Day 标题提供 `aria-expanded` 和 `aria-controls`。
- 完成主按钮会点亮当前步骤、推进到下一 Day/步骤并平滑定位；手动取消旧步骤时也会重新定位最早未完成项。
- 单步圆圈扩大到 44×44px，Day 标题最小高度 64px；当前步骤使用边框和文字双重提示，不只依赖颜色。
- 方案顶部明确展示来源/provider/model、仓库更新时间缓存依据、生成时间，以及“匿名会话 + 本机离线副本”的保存位置。
- 进度条提供 `role=progressbar`、数值范围和可访问名称。
- `scripts/verify.ts`：验证固定进度、当前任务、主推进按钮、只展开一个 Day、未来步骤不在首屏渲染和 44px 触摸区域。
- 本地 HTTP 回归：详细方案返回 200，实际输出总进度、当前任务、推进按钮、单一展开 Day、折叠 Day、缓存依据和触摸尺寸。
- `pnpm typecheck`、`pnpm verify` 和 `pnpm build` 通过。

下一步：执行 6.4 多尺寸、键盘和关键异常状态浏览器回归；修复回归中发现的问题后再进入第七阶段。

- 顶部固定总进度和当前任务。
- 默认展开当前 Day，已完成和未来 Day 折叠。
- 增加“完成并进入下一步”。
- 圆圈和交互区域满足移动端触摸尺寸。
- 明确显示进度保存位置、缓存版本和方案来源。

### 6.4 补浏览器回归

**状态：部分完成；真实浏览器已恢复，键盘输入与独立双会话证据仍阻塞（2026-07-12）**

已完成证据：

- 新增 `scripts/http-regression.ts` 和 `pnpm regression:http`，针对运行中的本地服务执行可重复 HTTP 回归。
- 已实际验证：首页、候选池、项目库、学习路线、收藏、历史、设置、项目详情、详细方案和健康检查返回正常状态。
- 新匿名会话下验证空收藏和空学习路线；验证未知路由返回 404 与正确空页面。
- 验证匿名 Cookie 的随机格式、HttpOnly/SameSite 属性，桌面/移动导航语义和安全区域类。
- 验证首页核心信息、折叠详情；详细方案当前任务、单一展开 Day、进度条语义、缓存依据和 44px 步骤按钮。
- `scripts/verify.ts` 已覆盖 GitHub/AI fallback、数据库错误分类、刷新持久任务、双会话隔离、进度冲突/删除和组件键盘语义。
- `pnpm typecheck`、`pnpm verify`、`pnpm regression:http` 和 `pnpm build` 均通过。
- 2026-07-12 内置浏览器已恢复并能实际打开本地 standalone 页面；390×844、768×1024、1440×1000 三个视口均确认首页无横向溢出，移动底栏/探索入口与桌面侧栏按断点正确切换。
- 浏览器截图已保存到 `artifacts/release-readiness/browser-6.4/`：`home-390x844.png`、`home-768x1024.png`、`home-1440x1000.png`、`404-390x844.png` 和 `focus-desktop.png`。
- 390px 真实浏览器中生成 3 天规则学习方案，页面明确显示“未配置 DeepSeek，本次没有发起模型调用”；点击“完成并进入下一步”后进度从 0% 推进，等待匿名会话同步后刷新仍恢复到 33%。
- 404 页面在 390px 下显示正确标题且无横向溢出；首页、学习方案和 404 标签页的浏览器控制台均无 error/warn。
- 桌面主导航获得焦点时存在约 3px teal 焦点环，证明 `focus-visible` 样式可见。

尚未完成：

- 实际 Tab 顺序、Enter/Space 操作和屏幕阅读器朗读检查。当前浏览器能把焦点落到目标控件并显示焦点环，但自动化层注入 Tab/Enter 后没有发生原生焦点移动或导航，不能把结构/样式证据冒充实际键盘证据。
- 浏览器中断网再联网和两套独立真实浏览器 Cookie 的端到端操作。当前内置浏览器的新标签页共享同一匿名会话，能验证跨标签页共享，但不能构造两个独立 Cookie 上下文。

阻塞原因：此前缺失运行目录的初始化问题已经恢复；当前剩余阻塞收敛为键盘事件注入无效、没有第二个独立 Cookie 上下文，以及尚未进行人工屏幕阅读器/断网操作。按照浏览器技能约束，没有改用未授权的独立自动化工具，也没有把焦点样式或共享标签页冒充为完整键盘/双会话证据。

处理原则：6.4 保持发布前门禁。可以继续不依赖浏览器的第七阶段数据/AI 工作，但正式发布前必须在浏览器环境恢复后补齐上述三项并修复发现的问题。

至少验证：

- 360/390px 手机宽度；
- 768px 平板宽度；
- 1280/1440px 桌面宽度；
- 键盘导航和 focus 状态；
- 加载、空数据、404、数据库失败、GitHub 失败、AI fallback；
- 刷新中跨页面返回；
- 详细步骤点亮、刷新保持和跨设备同步。

## 七、数据和 AI 优化阶段（P1）

- 把 enrichment 状态改成明确的“有/无/未知”，未知不能按负面信号评分。
- 候选池改为服务端分页、筛选和排序，避免一次向浏览器发送全部仓库。
- AI provider 按实际部署约束收敛为 `DeepSeek → 规则` fallback 链。
- 缓存键加入输入哈希、用户水平、目标、promptVersion、schemaVersion、provider 和 model。
- 统一 `radar_runs` JSON 与 `repo_scores`、`repo_analyses`、`recommendations` 规范化表的职责，避免两套数据源并存。
- 给候选和历史数据增加保留/归档策略。

### 7.1 Enrichment 有 / 无 / 未知三态化

**状态：已完成（2026-07-11）**

完成证据：

- `lib/repository-signals.ts` 统一定义 `present / absent / unknown`，旧本地 JSON 或旧数据库行缺少新字段时使用保守兼容：正信号仍识别为“有”，历史 `false` 识别为“未知”。
- `lib/github/discovery.ts` 只有在 GitHub README 或根目录请求成功后才写入明确的“有/无”；超时、限流和其他抓取失败继续保留“未知”。
- `migrations/0010_repository_signal_states.sql` 和 `lib/db/schema.ts` 增加 `enrichment_signals` JSONB，`lib/repository-store.ts`、`lib/radar-runs.ts` 同步完成持久化与旧数据归一化。
- `lib/scoring.ts` 对“未知”使用中性分，不再按缺失扣分；风险提示只在“已检查且没有”时出现。
- 候选列表和详情页展示三态徽标，README、语言和根目录空状态也区分“已确认没有”与“尚未成功读取”。
- AI 分析和详细学习方案收到显式三态信号；测试状态未知时先要求检查仓库结构，不再直接断言项目没有测试。
- `scripts/verify.ts` 覆盖旧数据兼容、未知中性评分、明确缺失风险和三态徽标；`pnpm typecheck`、`pnpm verify`、`pnpm build` 通过。

数据库说明：本轮环境未配置 `DATABASE_URL`，因此没有对真实 PostgreSQL 执行迁移；部署或连接数据库后必须运行 `pnpm db:migrate`。

下一步：执行 7.2，将候选池搜索、筛选、排序和分页移到服务端，避免一次加载全部候选数据。

### 7.2 候选池服务端分页、筛选和排序

**状态：已完成（2026-07-11）**

完成证据：

- `lib/repository-store.ts` 增加统一的候选查询结果和参数模型；PostgreSQL 使用参数化搜索、分类条件、排序、总数与 `LIMIT/OFFSET`，本地 JSON 使用同语义的服务端过滤和切页。
- `app/candidates/page.tsx` 解析并限制 `q/category/sort/page` URL 参数；只有存储源确实为空时才使用 seed，筛选无结果不会错误切换到 seed。
- `components/candidate-repository-browser.tsx` 改为服务端渲染的 GET 筛选表单和分页导航，不再用 `useMemo` 在浏览器接收、搜索全部候选。
- 支持 Stars 从高到低、最近更新优先和仓库名称排序；翻页链接保留当前搜索、分类和排序条件，越界页会收敛到有效范围。
- `scripts/verify.ts` 覆盖筛选、排序、分页、越界页、空结果和服务端页面标识；`scripts/http-regression.ts` 覆盖真实 HTTP URL 参数及空结果。
- `pnpm typecheck`、`pnpm verify`、`pnpm build` 和在临时本地服务上的 `pnpm regression:http` 通过。

限制：本轮未配置 `DATABASE_URL`，PostgreSQL 分支完成了类型、构建和参数化 SQL 审查，但尚未连接真实数据库执行集成测试。

下一步：执行 7.3，把 AI provider 收敛为 `DeepSeek → 规则` fallback 链，并记录每次 DeepSeek 尝试与 fallback 原因。

### 7.3 DeepSeek → 规则 fallback 与调用可观测性

**状态：已完成（2026-07-11）**

完成证据：

- 根据实际部署约束，`lib/ai/provider.ts` 移除 OpenAI 服务分支，只接受 `DEEPSEEK_API_KEY`；即使环境中仅存在 `OPENAI_API_KEY` 也不会选择或调用 OpenAI。
- `@ai-sdk/openai` 继续作为 DeepSeek OpenAI-compatible 协议适配器使用，不代表连接 OpenAI 服务；README 已明确这一点，`.env.example` 和部署文档不再声明 OpenAI 环境变量。
- `lib/ai/analyze.ts` 和 `lib/ai/detailed-study-plan.ts` 统一为 DeepSeek 文本 JSON、Zod 校验、超时与规则 fallback；失败摘要通过统一错误分类器脱敏。
- 每次真实 DeepSeek 尝试记录 provider、model、成功/失败、错误分类、是否可重试和 Token usage；未配置或未进入分析额度时 `providerAttempts` 为空，明确表示没有发起调用。
- `lib/daily-radar.ts` 把逐推荐 `analysisTrace` 写入雷达结果；`lib/radar-runs.ts` 对历史 JSON/PostgreSQL 数据做兼容归一化，新的调用轨迹随 `recommendations` 持久化。
- 推荐卡、项目详情、历史运行页和详细学习方案统一显示 DeepSeek/规则来源；项目详情能区分调用成功、调用失败、未配置和未进入调用额度。
- `scripts/verify.ts` 验证 OpenAI-only 配置被忽略、无 Key 不调用、DeepSeek 成功/失败轨迹、批次熔断、排序与 Token 汇总；`pnpm typecheck`、`pnpm verify`、`pnpm build` 和临时本地服务上的 `pnpm regression:http` 通过。

验证边界：本轮没有执行 `pnpm ai:smoke`，因为该命令会真实调用 DeepSeek 并消耗 Token；正式部署前由维护者在受控环境执行一次即可。

下一步：执行 7.4，重构详细方案缓存键，加入输入哈希、用户水平、目标、promptVersion、schemaVersion、provider 和 model，避免提示词或输入变化后误命中旧缓存。

### 7.4 详细学习方案缓存键版本化

**状态：已完成（2026-07-11）**

完成证据：

- `lib/detailed-study-plan-cache.ts` 统一生成 SHA-256 输入哈希和缓存键，键中包含仓库/评分/分析输入、周期、学习水平、目标、promptVersion、schemaVersion、provider 和 model。
- 仓库 topics、文件和依赖等无序集合先排序再哈希，避免只因 API 返回顺序变化造成无意义失效；README、评分证据或方案输入真实变化时会产生新哈希。
- `lib/ai/detailed-study-plan.ts` 把学习水平与目标真正加入 DeepSeek 输入和规则方案内容，并把完整缓存元数据写入方案；未配置 DeepSeek 时使用明确的 `rule-v2` 身份。
- `lib/detailed-study-plans.ts` 使用缓存键做命中和并发去重；相同输入只生成一次，不同学习画像、输入或模型可以并存，旧方案缺少缓存版本时保留但不自动复用。
- `migrations/0011_detailed_plan_cache_identity.sql` 增加缓存审计列，移除旧的 `(repo_id, duration)` 唯一约束，改为唯一 `cache_key`；本地 JSON 与 PostgreSQL 使用一致语义。
- 首页、收藏、学习路线和详细方案页只把当前用户画像与当前输入匹配的方案视为“已生成”；API 在限流前检查精确缓存，缓存命中不消耗生成配额。
- 详细方案页面显示学习水平、目标、缓存版本和输入哈希短标识，明确提示缓存校验范围。
- `scripts/verify.ts` 覆盖确定性、无序输入稳定性、README/水平/目标/provider/model 失效、旧数据不命中、多画像共存和并发去重；`pnpm typecheck`、`pnpm verify`、`pnpm build` 和临时本地服务上的 `pnpm regression:http` 通过。

数据库说明：本轮未配置 `DATABASE_URL`，迁移文件和 SQL 分支已通过类型、构建与静态审查，但仍需在真实 PostgreSQL 执行 `pnpm db:migrate` 后做集成验证。

下一步：执行 7.5，统一 `radar_runs` JSON 与 `repo_scores`、`repo_analyses`、`recommendations` 规范化表的职责，确定单一读取源和重建边界。

### 7.5 雷达快照与规范化投影职责统一

**状态：已完成（2026-07-11）**

完成证据：

- [DATA_MODEL.md](./DATA_MODEL.md) 明确 `radar_runs` 是页面/API 唯一运行时读取源；`repo_scores`、`repo_analyses`、`recommendations` 只作为可从快照重建的 SQL 审计/统计投影，页面禁止混读。
- `lib/radar-run-projection.ts` 从完整快照确定性生成三类投影，校验推荐数量、repository ID 和 rank 唯一性，并为分析保存 prompt/schema 版本及包含公共偏好快照的输入哈希。
- `lib/daily-radar.ts` 在恢复检查点、最终结果和失败 fallback 中都保存本次公共雷达偏好；旧运行没有偏好时按 `undefined` 兼容。
- `lib/radar-runs.ts` 在 PostgreSQL 中使用单一事务写入/更新快照、upsert 仓库内部 ID、删除旧投影并重建三类投影；任一步失败会整体回滚。本地 JSON 只保存快照，保持相同读取语义。
- `migrations/0012_radar_run_projections.sql` 为分析和推荐增加 `run_id`、来源、fallback/provider 轨迹及唯一约束，为 `radar_runs` 增加 `preference_snapshot`。
- `pnpm db:rebuild-radar-projections` 可从现有 `radar_runs` 幂等重建全部投影，不调用 GitHub 或 DeepSeek；未配置数据库时安全跳过。
- `scripts/verify.ts` 覆盖投影行数、模型/来源、版本、输入哈希稳定与失效、重复仓库/rank 拒绝、快照计数不一致和无数据库重建跳过；`pnpm typecheck`、`pnpm verify`、`pnpm build` 和临时本地服务上的 `pnpm regression:http` 通过。

数据库说明：本轮未对真实 PostgreSQL 执行迁移或事务集成测试。部署时必须先运行 `pnpm db:migrate`，再运行 `pnpm db:rebuild-radar-projections`，并核对三类投影每个 run 的行数。

下一步：执行 7.6，为候选仓库、雷达运行、任务运行、详细方案和限流数据增加明确的保留/归档策略与可安全执行的清理命令。

### 7.6 数据保留、归档与安全清理

**状态：已完成（2026-07-11）**

完成证据：

- [DATA_RETENTION.md](./DATA_RETENTION.md) 定义雷达、终态任务、详细方案、仓库快照、候选仓库和限流桶的默认周期、覆盖变量和保护条件。
- `lib/data-retention.ts` 同时支持本地 JSON 与 PostgreSQL；默认只返回 dry-run 报告，apply 模式才执行归档/清理。
- `pnpm data:retention -- --apply --confirm=delete-expired-data` 同时要求 apply 和固定确认字符串，缺少确认时拒绝运行。
- 旧雷达在删除热数据和派生投影前先归档：PostgreSQL 写入 `radar_run_archives`，本地写入 `.data/archive/radar-runs.json`。
- `migrations/0013_data_retention.sql` 增加冷归档表和保留查询索引；PostgreSQL 清理在单一事务内执行。
- 运行中/排队任务、每组最新详细方案、有学习进度的方案、每仓库最新快照，以及仍被热雷达、方案、收藏或反馈引用的候选不会被删除。
- 移除本地模式原先对 20 条雷达、300 个任务和 120 个方案的静默截断，所有删除统一经过可预览策略。
- 隔离临时文件测试覆盖 dry-run 不写文件、归档后删除、运行任务保护、方案进度保护、候选引用保护、最新快照保护、限流桶清理和二次 apply 幂等；`pnpm typecheck`、`pnpm verify`、`pnpm build` 和临时本地服务上的 `pnpm regression:http` 通过。

验证边界：本轮没有对项目真实 `.data` 或 PostgreSQL 执行 apply，只在系统临时目录完成清理测试。正式环境执行前必须先备份并核对 dry-run 报告；本地多文件模式执行 apply 时应暂停 Web 与 Worker。

下一步：进入 8.1，建立开源发布前仓库卫生检查，确认忽略规则、环境变量模板、License/贡献/安全文档、CI、部署文档和发布检查命令；Git 工具可用后再初始化仓库和生成首个提交。

## 八、正式开源与发布阶段（P1）

当前已经有 CI、License、贡献指南和安全文档，但真正发布前还需要：

1. 安装或提供 Git，初始化有效仓库。
2. 检查 `.gitignore`，确认 `.env.local`、`.data`、日志和构建产物未进入版本库。
3. 创建首个干净提交并检查完整差异。
4. 在 GitHub 创建仓库，设置默认分支保护和 Required CI。
5. 启用 Private Vulnerability Reporting。
6. 替换 README 中的本地说明，补实际仓库地址、在线 Demo、截图和架构图。
7. 配置 Dependabot、Issue/PR 模板和发布标签。
8. 发布 `v0.1.0`，记录已知限制和迁移步骤。

### 8.1 开源发布前仓库卫生检查

**状态：本地 Git 跟踪与 Private 仓库首次推送已完成；真实 CI 待确认（2026-07-12）**

已完成：

- `.gitignore` 覆盖依赖、构建产物、本地数据、环境文件、日志、证书/私钥、凭据文件、`.pnpm-store` 和 Codex 本地协调目录；`.env.example` 保持可提交且敏感变量值必须为空。
- `scripts/repository-hygiene.ts` 检查必需文档、环境模板、包元数据、CI 最小权限、高置信度 Token/私钥/带密码数据库 URL，以及 Git 已跟踪的敏感文件。
- `pnpm repo:hygiene` 可在开发环境运行；`pnpm release:check` 使用严格 Git 模式并串联类型、测试和构建门禁。
- CI 使用 `persist-credentials: false`、只读权限、严格仓库卫生检查、类型/测试/构建和生产服务器 HTTP 回归；未配置 PostgreSQL 时允许健康接口返回经过断言的 `503 degraded/local-json`。
- Daily Radar workflow 增加只读权限、并发互斥和 `CRON_SECRET` 非空检查。
- 增加 Dependabot、Bug/Feature Issue 模板、PR 模板和 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。
- 仓库卫生规则测试覆盖敏感 Key、带密码数据库 URL、测试 Bearer 例外和缺失忽略规则。
- `pnpm repo:hygiene`、`pnpm typecheck`、`pnpm verify`、`pnpm build` 通过；生产构建启动后的 `pnpm regression:http` 通过。

2026-07-12 恢复证据：已从 Git 官方下载页取得 Git for Windows 2.55.0.windows.2，安装包 Authenticode 签名有效；本地仓库已初始化为 `main`。`git status --untracked-files=all` 显示 152 个候选文件、约 1.05 MB，没有超过 500 KB 的单文件；`.env.local`、`.data`、`node_modules`、`.next` 和日志均由 `.gitignore` 排除，`.env.example` 的 GitHub/DeepSeek/数据库/管理员密钥值为空。截图证据目录将纳入首个提交。

本地完成证据：仅在当前仓库配置 GitHub noreply 作者身份；新增 `.gitattributes` 统一跨平台 LF 并把截图格式声明为二进制。最终索引包含 153 个文件、18,553 行变更；`git diff --cached --check`、敏感路径检查和严格 `scripts/repository-hygiene.ts --strict` 均通过。首个提交为 `7a188bd chore: establish initial project baseline`。

下一步：打开私有仓库的 Actions 页面，观察首次 `CI` 与 `container-integration` 真实结果；失败时先修复并重新推送，通过后再配置分支保护与 Required CI。仓库继续保持 Private，不创建 tag 或 Release。

### 8.2 v0.1.0 发布资料准备

**状态：已完成（2026-07-12）；版本尚未发布**

完成证据：

- [CHANGELOG.md](./CHANGELOG.md) 使用 `Unreleased` 记录当前能力、安全变化和已知限制，没有伪造已经发布的版本日期。
- [RELEASE_NOTES_v0.1.0.md](./RELEASE_NOTES_v0.1.0.md) 可作为首个 GitHub Release 草案，包含核心能力、最低部署要求、迁移 0001–0013、验证证据、发布前门禁和已知限制。
- README 显示 `v0.1.0 Release Candidate` 状态，增加从浏览器、任务队列、Worker、GitHub、DeepSeek/规则 fallback 到 `radar_runs` 的架构图，并链接数据模型、部署和发布资料。
- README 明确真实 Git、PostgreSQL、多 Worker、浏览器、仓库/Demo/截图和匿名身份限制；不把 HTTP/构建验证写成真实设备或数据库证据。
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) 覆盖本地 Git、GitHub 安全设置、数据库/部署、受控 smoke test 和发布后运维。
- `package.json` 固定 `0.1.0`、Node/pnpm、MIT、项目描述和关键词，并保持 `private: true` 防止误发 npm。
- 仓库卫生门禁强制 package 版本、对应 Release Notes、Changelog Unreleased、README 架构/已知限制保持一致。
- `pnpm repo:hygiene`、`pnpm typecheck`、`pnpm verify`、`pnpm build` 和生产构建上的 `pnpm regression:http` 通过；仅保留 Git 不可用警告。

未完成：没有创建 Git commit、tag 或 GitHub Release，也没有填写真实仓库 URL、在线 Demo、维护者联系方式和产品截图。这些内容必须在对应资源真实存在后补充，不能使用占位内容冒充。

下一步：执行 8.3，补可移植的生产部署基线和 PostgreSQL 集成验证入口；同时继续保留 6.4 真实浏览器、8.1 严格 Git 检查为发布门禁。

### 8.3 可移植生产部署与 PostgreSQL 集成入口

**状态：代码与自动化入口已完成（2026-07-12）；容器/数据库实跑门禁待外部环境**

已完成：

- Next.js 使用 standalone 生产输出；`scripts/prepare-standalone.mjs` 把 `public` 和 `.next/static` 一并装入自包含产物，`pnpm start` 与 Web 镜像运行同一个 `.next/standalone/server.js`，避免本地、CI、容器使用不同启动路径。
- `Dockerfile` 提供非 root `web` 和 `worker` target。Web 含进程可达健康检查，Worker 仅安装生产依赖并运行持久化任务消费者；`tsx` 因 Worker 运行时确实需要而移入生产依赖。
- `.dockerignore` 排除环境变量、本地数据、Git 元数据、缓存和常见私钥；仓库卫生脚本会校验这些规则、两个 target、非 root 用户、standalone 启动方式和 Worker 运行依赖。
- `compose.integration.yml` 提供只面向本机/CI 的 PostgreSQL 16、迁移和集成测试服务，使用明确的本地固定账号，不注入 GitHub Token 或 DeepSeek Key。
- `scripts/postgres-integration.ts` 需要 `ALLOW_POSTGRES_INTEGRATION_TEST=1`，并拒绝数据库名不包含 `test`/`integration` 的目标；测试覆盖迁移 0013、雷达快照事务、三类规范化投影的内部仓库 ID、候选读取、规则方案缓存和并发 Worker 原子领取，最后事务清理唯一夹具。
- CI 新增独立容器任务：构建 Web 镜像、构建 Worker 测试镜像、启动临时 PostgreSQL、执行迁移与 `pnpm db:integration`，最后无条件删除临时 volume。该任务不需要也不会读取 GitHub/DeepSeek Secret。
- [DEPLOYMENT.md](./DEPLOYMENT.md)、README、Changelog、Release Notes 与发布检查表已写明容器命令、测试数据库边界和生产发布顺序。

当前工作区验证证据：

- `tsc --noEmit`、`scripts/verify.ts`、`scripts/repository-hygiene.ts` 通过；仓库卫生仅保留 Git 不可用警告。
- Next.js standalone 生产构建通过，确认 `server.js`、`public` 和静态资源都存在于产物中。
- standalone 服务启动后的完整 `scripts/http-regression.ts` 通过。
- 集成安全规则测试确认：测试库 + 显式确认可进入，生产命名数据库或缺少确认会在连接前被拒绝。

尚未完成的门禁：当前机器没有 Docker、`psql` 或 Git，因此不能在本机解析/构建镜像、启动真实 PostgreSQL、执行迁移事务或验证 Git 跟踪状态。新增 GitHub Actions 任务也尚未在真实仓库运行，不能把“已配置”记成“已通过”。

下一步：Git/GitHub 环境可用后先运行 CI 的 `container-integration` 并保存结果；Docker 环境可用后按 [DEPLOYMENT.md](./DEPLOYMENT.md) 本机复跑。两者至少一处取得真实 PostgreSQL 成功证据后，才把 8.3 标为完全完成。随后进入 8.4 预发布部署演练：选择平台、配置最小权限 PostgreSQL/Web/Worker/Cron、执行迁移与回滚演练，并核对生产健康检查。

### 8.4 预发布配置、最小权限与故障演练基线

**状态：平台无关实现已完成（2026-07-12）；真实云资源演练待平台与密钥**

已完成：

- 新增 `scripts/production-check.mjs`，提供 `web`、`worker`、`migration` 三个 profile。它只读取环境变量，不连接数据库、不访问 GitHub/DeepSeek，并以脱敏错误检查 PostgreSQL URL、HTTPS 公网域名、密钥长度/隔离、DeepSeek 配置和所有数字调优边界。
- Web/Worker 容器在主进程启动前强制运行对应预检；`pnpm start` 和 `pnpm db:migrate:production` 同样带预检，`start:regression` 明确只供本地/CI 降级回归。
- 生产 Web 不再因为入队而要求 `GITHUB_TOKEN`，Token 收敛到真正执行 discovery 的 Worker；开发环境仍保留缺 Token 的明确错误。预检会提示 Web/Worker/Migration 持有的不必要密钥。
- 公开地址从构建期 `NEXT_PUBLIC_SITE_URL` 迁移为运行时 `SITE_URL`。首页 canonical/Open Graph、sitemap 和 robots 都读取同一个运行时 origin；旧变量仅为本地兼容，生产预检会要求迁移。
- sitemap 与 robots 改为动态元数据路由，同一个 standalone 镜像可在启动时绑定预览或正式域名，不再把构建机器的 localhost 固化进镜像。
- [OPERATIONS.md](./OPERATIONS.md) 固化进程权限矩阵、部署顺序、向前 schema 回滚策略、数据库恢复、任务堆积、GitHub/DeepSeek/Cron 故障和数据保留演练。
- CI 使用安全合成变量运行 Web 预检，并在 standalone HTTP 回归中断言首页、sitemap、robots 都使用运行时域名；仓库卫生门禁检查预检入口、容器命令、运行时域名变量和运行手册。

验证证据：

- `tsc --noEmit`、无缓存 `scripts/verify.ts` 和仓库卫生检查通过；仅有 Git 不可用警告。
- 预检测试覆盖 Web 成功、Worker 缺 GitHub Token 失败、Worker 成功、旧站点变量失败，且输出不包含 Token 或数据库 URL。
- 不带生产域名完成 standalone 构建；启动时注入 `SITE_URL=https://runtime.example.invalid` 后，首页 canonical、sitemap、robots 和完整 HTTP 路由回归通过，响应中没有构建期 localhost。
- Next.js 构建结果将 `/robots.txt`、`/sitemap.xml` 标记为动态路由，证明域名不是静态产物。

尚未完成：没有真实平台、DNS、TLS、托管 PostgreSQL、镜像仓库或生产 Secret，因此不能执行真实迁移、备份恢复、Worker/Cron 联调、镜像回滚和外部健康观察。平台未确定前不能编造平台专属配置或成功证据。

下一步：由维护者确定 Web/Worker 托管平台、PostgreSQL 提供方和正式域名后，按 [OPERATIONS.md](./OPERATIONS.md) 创建最小权限环境，先在预览环境完成 8.3 容器/PostgreSQL 门禁，再执行 8.4 的备份、迁移、健康、任务、Cron 和回滚演练。真实 DeepSeek smoke 仍只手动调用一次。

### 8.5 发布剩余证据审计

**状态：已完成（2026-07-12）；工程进入外部环境门禁阶段**

- 新增 [RELEASE_READINESS.md](./RELEASE_READINESS.md)，逐项区分当前工作区已证明、仅配置了自动化、仍缺真实环境和最终发布证据，不再依靠上下文记忆判断完成度。
- 初次审计确认 Git、Docker、`psql` 均不可用；2026-07-12 后续已恢复 Git 并初始化本地 `main`，Docker/`psql` 仍不可用。Git 候选与忽略规则审计结果记录在 8.1。
- 2026-07-12 继续时内置浏览器运行目录已经恢复，已补 390/768/1440 多视口、404、规则方案、步骤刷新保持、控制台和焦点环证据；完整结果与剩余限制记录在 6.4 和 `RELEASE_READINESS.md`。没有把无效的 Tab/Enter 注入或共享 Cookie 标签页伪造成完整键盘/双会话证据。
- 证据矩阵明确列出 Git、浏览器、Docker/PostgreSQL、GitHub 设置、外部 smoke、预发布、备份回滚和正式 Release 的权威证据与恢复入口。
- 恢复顺序固定为：Git/CI → Docker/PostgreSQL → 浏览器 6.4 → 预发布/回滚 → 受控 GitHub/DeepSeek smoke → tag/Release。外部条件未变化时不再重复已知失败的门禁。

本地 Git 门禁、首个提交和 Private 仓库首次推送已完成；`origin/main` 与本地 `228010d` 一致。下一步由 GitHub Actions 补容器/PostgreSQL 证据并配置 Required CI。浏览器独立会话/人工键盘回归和预发布平台仍待后续条件。

## 九、每阶段统一验证命令

```bash
pnpm repo:hygiene
pnpm typecheck
pnpm verify
pnpm build
```

涉及数据库时额外执行：

```bash
pnpm production:check -- --profile=migration
pnpm db:migrate:production
```

涉及真实 GitHub 或 DeepSeek 时，不要直接把真实调用加入普通 CI。使用受控 smoke test，并记录调用次数、耗时、fallback 和 Token。

## 十、当前下一步

下一次继续开发时先读取 [RELEASE_READINESS.md](./RELEASE_READINESS.md)，只选择已经具备外部条件的第一项：Git/CI、Docker/PostgreSQL、浏览器剩余人工/独立会话证据或预发布平台。没有条件变化时不要重复同一失败尝试。

4.1–4.4、5.2–5.3、6.1–6.3、7.1–7.6、8.2 和 8.5 已完成；8.3 的容器/数据库入口和 8.4 的平台无关预发布基线已完成但缺真实基础设施证据；6.4 已取得真实多视口/交互的部分证据但仍缺实际键盘、屏幕阅读器、断网和独立双会话，8.1 仍缺 Git 跟踪审计。完整阻塞矩阵见 `RELEASE_READINESS.md`。
