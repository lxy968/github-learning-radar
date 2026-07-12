## 变更说明

- 解决的问题：
- 用户可见变化：
- 数据迁移或缓存影响：

## 验证

- [ ] `pnpm repo:hygiene`
- [ ] `pnpm typecheck`
- [ ] `pnpm verify`
- [ ] `pnpm build`
- [ ] 涉及页面时已完成桌面端和移动端检查
- [ ] 涉及 DeepSeek 时已说明调用上限、缓存、fallback 和 Token 影响

## 安全与发布

- [ ] 没有提交 `.env.local`、`.data`、Token、数据库 URL 或构建产物
- [ ] 新增环境变量已同步到 `.env.example` 和部署文档
- [ ] Schema、Prompt 或缓存键变化已增加版本和迁移说明
