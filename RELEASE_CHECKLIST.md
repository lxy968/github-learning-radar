# 开源与正式发布检查表

当前证据状态和每项门禁的恢复入口见 [RELEASE_READINESS.md](./RELEASE_READINESS.md)；本表只在真实证据存在后勾选。

## 本地仓库门禁

- [ ] Git 可执行，`.git/HEAD` 与 index 有效。
- [ ] `git status --short` 只包含预期变更。
- [ ] `.env.local`、`.data`、`.next`、`.pnpm-store` 和构建日志未被跟踪。
- [ ] `pnpm release:check` 通过。
- [ ] `pnpm history:secrets` 对完整 Git 历史通过，输出中没有敏感值。
- [ ] `pnpm audit:prod` 无中危、高危或严重生产依赖漏洞。
- [ ] `pnpm regression:http` 在生产构建启动后通过。
- [ ] 360/390、768、1280/1440px 浏览器回归和键盘检查完成（路线图 6.4）。
- [ ] 部署当天重新核对 Vercel Hobby 与 Neon Free 官方额度；不绑卡、不升级付费、不启用按量计费。

## GitHub 仓库设置

- [ ] 设置仓库描述、Topics、主页地址和 MIT License 识别。
- [ ] 默认分支设为 `main`，启用分支保护并要求 CI 通过。
- [ ] 启用 Dependabot alerts、secret scanning 和 Private Vulnerability Reporting。
- [ ] 设置 `RADAR_CRON_URL`、`CRON_SECRET`，确认 Actions 日志不输出密钥。
- [ ] 检查 Issue/PR 模板和行为准则链接。

## 数据库与部署

- [ ] Neon Web 使用池化 URL，Migration 使用直连 URL；两者都包含 `sslmode=require`，且没有写入仓库或日志。
- [ ] Vercel 只配置 showcase 所需的五个 Production 变量，未配置 GitHub/DeepSeek/OpenAI/Admin/Cron Secret。
- [ ] Vercel 版本化 `vercel.json` 的 Web 生产预检通过，并只构建 Production 分支。
- [ ] 生产 PostgreSQL 已备份。
- [ ] Web、Worker、Migration 三个 `production:check` profile 分别通过，警告已人工确认。
- [ ] Web 未注入 `GITHUB_TOKEN`，Worker 未注入管理员/Cron/SITE 密钥，Migration 只持有数据库配置。
- [ ] `docker build --target web` 和 `docker build --target worker` 成功，镜像中未包含 `.env` 或本地数据。
- [ ] `compose.integration.yml` 的迁移与 `pnpm db:integration` 在隔离 PostgreSQL 成功，结束后临时 volume 已删除。
- [ ] `pnpm db:migrate` 在目标数据库成功。
- [ ] `pnpm db:rebuild-radar-projections` 完成，投影行数与热雷达一致。
- [ ] 数据保留 dry-run 数量已核对，apply 策略与备份周期一致。
- [ ] Web、Worker 和 Cron 分别部署并使用最小权限密钥。
- [ ] `/api/health` 返回 PostgreSQL 存储、无过期运行任务。
- [ ] sitemap、robots、canonical 使用运行时 `SITE_URL`，不含构建环境 localhost 或预览域名。

## 外部服务受控验证

- [ ] GitHub discovery smoke test 成功，未触发异常限流。
- [ ] `pnpm ai:smoke` 使用受控 DeepSeek Key 成功，并记录 Token；不在普通 CI 中运行。
- [ ] DeepSeek 不可用时，规则 fallback 和错误提示经过验证。
- [ ] 两个独立匿名浏览器会话的数据隔离经过验证。

## 发布后

- [ ] 首页、候选池、项目详情、学习方案、收藏、历史与设置页可访问。
- [ ] Sitemap、robots、Open Graph URL 使用正式域名。
- [ ] 定时刷新、Worker 领取、失败重试与运行历史正常。
- [ ] 建立日志、告警、数据库备份和冷归档恢复演练。
- [ ] 按 `OPERATIONS.md` 完成一次应用镜像回滚和隔离数据库恢复演练，并保存脱敏证据。
