# 发布就绪证据矩阵

本文件记录“当前已经由证据证明什么”，并把代码存在、自动化已配置、当前机器已通过、真实生产已通过四种状态分开。没有真实运行证据的项目不能标为完成。

## 当前工作区已证明

| 门禁 | 当前证据 | 结论 |
| --- | --- | --- |
| TypeScript | `tsc --noEmit` 成功 | 通过 |
| 逻辑与安全规则 | `scripts/verify.ts` 成功，覆盖评分、缓存、会话、任务、保留、生产预检和最小权限规则 | 通过 |
| Git 跟踪审计 | Git 2.55.0.windows.2、本地 `main`、GitHub noreply 作者、首个提交 `7a188bd`；Private 远端基线为 `1687581`，当前第一阶段优化仍是本地未提交改动；严格仓库卫生与 `git diff --check` 通过 | 通过（当前改动未推送） |
| 仓库静态卫生 | `.env.local`、`.data`、依赖、构建、日志和私钥被忽略；`.env.example` 密钥为空；`.gitattributes` 固定跨平台 LF/二进制图片 | 通过 |
| standalone 构建 | Next.js 生产构建成功，产物含 server、public、static 和生产预检 | 通过 |
| 生产 HTTP | 首页、主要页面、404、Cookie、健康、学习方案入口等回归成功 | 通过 |
| 运行时域名 | 构建后注入临时 `SITE_URL`，首页 canonical、sitemap、robots 均使用运行时域名 | 通过 |
| DeepSeek fallback | 未配置/失败时规则 fallback、调用轨迹和 Token 处理已有自动化测试 | 通过（无真实模型调用） |
| 内容质量与模型分工（第一阶段） | Flash 按学习水平调整语言，默认首页展示 7 项且 7 项都尝试 Flash；Pro 对 3/7/14 天使用一次完整后台生成，默认 300 秒、最大可配置 600 秒，项目不设置额外输出 Token 上限；三张卡片严格串行但轮询不抢占用户当前查看状态；Windows 本地任务文件写入具备锁冲突重试和回退；模型 JSON 支持围栏/前后文字提取及超量字段安全收敛；Web 不持有 DeepSeek 密钥，迁移 0014 提供数据库级活跃任务唯一约束；模拟慢响应、并发入队和一次完整保存已通过；生产浏览器确认 7 天卡片等待后仍保持选中，390px 无横向溢出或控制台错误 | 类型/逻辑/卫生/构建/HTTP/浏览器已通过；受控首页刷新 7/7 Flash 成功，3 天 Pro smoke 通过，7/14 天真实方案生成待用户按需验证 |
| 候选学习入口与界面配置隔离 | 已保存候选无需进入今日推荐即可打开 3/7/14 天方案页；学习方案 API、后台任务和缓存都能解析候选仓库。用户界面不显示 Flash、Pro、供应商或模型 ID，只说明智能分析、智能生成与内置规则；底层仍只接受既定 DeepSeek 配置。重复的“项目库”已并入候选项目，旧地址保留兼容跳转 | 类型/逻辑/卫生/构建通过；生产 HTTP 确认候选详情、方案页、任务 `202` 入队和旧地址跳转，Worker 未运行、无真实模型调用 |
| PostgreSQL 防误操作 | 集成脚本需要显式确认并限制测试数据库名；无确认时在连接前拒绝 | 通过 |
| 真实浏览器（部分） | 内置浏览器已恢复；390/768/1440 首页、404、规则学习方案、步骤刷新保持、焦点环和控制台已实跑，截图位于 `artifacts/release-readiness/browser-6.4/` | 条件通过；键盘事件、屏幕阅读器、断网和独立双会话仍待补 |
| GitHub CI | Private 仓库提交 `148d9ff` 的 CI #8 整体成功；`verify` 与 `container-integration` 均为绿色 | 通过 |
| CI Actions 运行时维护 | 工作流已升级为 `actions/checkout@v7`、`actions/setup-node@v6`、`pnpm/action-setup@v4.4.0`；仓库卫生固定检查版本；清空 AI 密钥后的类型、逻辑、卫生、构建与独立端口 HTTP 回归均通过 | 本地通过；远程 CI 待推送后确认 |
| Docker/PostgreSQL 集成 | GitHub Actions 构建 Web/Worker 镜像，启动 PostgreSQL 16，完成迁移、事务投影/缓存/并发领取集成和清理；未注入 GitHub/DeepSeek Secret | 通过（CI 环境） |

这些证据不能替代下表的真实工具、浏览器、数据库和云资源验证。

## 尚缺外部证据

| 发布门禁 | 当前状态 | 需要的权威证据 | 恢复条件/入口 |
| --- | --- | --- | --- |
| 真实浏览器 6.4 | 运行时已恢复；390/768/1440、移动/桌面导航、404、规则方案、步骤刷新保持、焦点环和无控制台错误已通过。自动化 Tab/Enter 未产生原生事件，新标签页共享同一 Cookie 上下文 | 实际 Tab/Enter/Space 与屏幕阅读器、断网恢复、两套独立浏览器 Cookie 隔离证据 | 使用可注入真实键盘事件且支持第二隔离上下文的浏览器，或由维护者完成人工回归；不重复已通过的截图/布局检查 |
| GitHub 仓库设置 | Private 仓库已推送，提交 `148d9ff` 的完整 CI 通过；Actions 运行时升级的本地门禁已通过、远程结果待确认；Dependabot 已创建升级 PR，但分支保护与安全设置尚未核对 | 本次工作流远程 CI、分支保护、Required CI、Dependabot 绿色更新、Secret Scanning、Issue/PR 模板页面 | 推送后先确认本次 CI；再按 `RELEASE_CHECKLIST.md` 配置保护规则；红色 Dependabot PR 不合并，仓库继续保持 Private |
| GitHub discovery smoke | 普通 CI 不调用外部 API | 受控调用次数、限流、耗时、候选数量和脱敏日志 | 在预览 Worker 使用最小权限 Token 手动运行一次 |
| DeepSeek smoke | Flash 启用官方 JSON Output 后单次分析成功，总 Token 3155；后续首页七项受控刷新发现 48 个候选，7 项均发起 Flash，首轮 5 成功、2 项只做定向重试后成功，最终 7/7 为 `deepseek-v4-flash`，累计输入 10,435、输出 10,518、合计 20,953 Token；3 天 `deepseek-v4-pro` 在格式容错修复后用 62.98 秒返回完整方案，输入 1507、输出 4616、合计 6123 Token；均为手动受控调用 | 7/14 天长方案输出尚未真实调用；七项 Flash 的 API/快照证据通过，当前标签页视觉效果待用户刷新确认 | 用户按需手动生成 7 天，再决定是否值得为 14 天消耗更多 Token；普通 CI 继续禁用真实 AI |
| 预发布部署 | 平台、PostgreSQL、域名和 Secret 未确定 | HTTPS 站点、Web/Worker/Cron、`status: ok`/`storage: postgres` | 选择平台后执行 `DEPLOYMENT.md` 与 `OPERATIONS.md` |
| 备份与回滚 | 没有真实数据库和镜像仓库 | 可恢复备份、镜像 digest 回滚、任务恢复和脱敏演练记录 | 预发布环境执行一次完整演练 |
| 正式发布资料 | 没有真实 URL、截图、commit/tag | 仓库/Demo 链接、产品截图、commit、`v0.1.0` tag 和 Release | 上述门禁通过后更新 Release Notes |

## 恢复顺序

1. Git/GitHub、严格仓库门禁与真实 CI 已完成；继续保留 `main` 保护规则配置。
2. GitHub Actions Docker/PostgreSQL 集成已完成；本机 Docker 复跑为可选补充证据。
3. 当前先完成 6.4 剩余实际键盘、屏幕阅读器、断网和独立双会话回归。
4. 选择预发布平台、数据库和域名，按 `OPERATIONS.md` 完成最小权限、迁移、健康、Worker/Cron、备份与回滚。
5. 最后执行受控 GitHub/DeepSeek smoke，补真实截图、URL、tag 和 Release。

任何一次继续开发前，先核对本矩阵和 `ROADMAP.md` 的“当前下一步”；若外部条件没有变化，不重复运行同一个已知失败的环境门禁。
