# 贡献指南

感谢你改进 GitHub 学习雷达。提交代码前请先阅读本指南和 `SECURITY.md`。

## 本地开发

1. 使用 Node.js 22 或兼容版本，并启用 Corepack。
2. 执行 `pnpm install --frozen-lockfile`。
3. 复制 `.env.example` 为 `.env.local`，只填写你确实需要的本地密钥。
4. 执行 `pnpm dev`，访问 `http://127.0.0.1:3000`。

## 提交前检查

```bash
pnpm repo:hygiene
pnpm typecheck
pnpm verify
pnpm build
```

Git 已初始化的发布分支还应运行 `pnpm release:check`；该命令会用严格模式检查 Git 跟踪文件，再执行全部门禁。

请不要提交 `.env.local`、`.data`、真实 Token、数据库连接串或构建产物。

## Pull Request

- 一个 PR 只解决一个主题。
- 说明用户可见变化、数据迁移和验证方式。
- 修改 API、schema、提示词或缓存键时，必须补充测试和版本说明。
- 涉及 UI 时附上桌面端和移动端截图。
- 涉及 DeepSeek 调用时说明最大调用次数、超时、缓存和 fallback 行为。

## 设计原则

- GitHub 数据抓取、过滤、缓存和限流由代码控制。
- AI 只使用明确提供的仓库证据，不虚构文件或功能。
- 失败时必须返回可解释的状态或规则 fallback。
- 公网写接口必须考虑认证、限流、幂等与成本上限。
