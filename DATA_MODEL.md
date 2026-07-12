# 雷达数据所有权与投影边界

本文规定雷达运行数据的唯一读取源、规范化投影职责和重建方式。修改相关存储代码前应先保持这些约束。

## 单一运行时读取源

`radar_runs` 是页面和 API 的唯一雷达运行读取源。一次运行的状态、指标、偏好快照和完整推荐列表都保存在同一行中；`lib/radar-runs.ts` 负责读取与旧数据归一化。

页面不得把 `repo_scores`、`repo_analyses` 或 `recommendations` 与 `radar_runs` 混合读取。否则在刷新中间状态、失败恢复或投影重建期间会得到互相矛盾的数据。

## 表职责

| 表 | 职责 | 是否供页面读取 | 是否可重建 |
| --- | --- | --- | --- |
| `radar_runs` | 完整运行快照和恢复边界 | 是，唯一来源 | 否，属于源数据 |
| `repositories` | GitHub 仓库身份和最新 enrichment | 候选池读取 | 可从 discovery/雷达快照补充 |
| `repository_snapshots` | 每日 Stars/Forks/Issue 趋势 | 候选趋势计算 | 可通过后续抓取继续积累 |
| `repo_scores` | 按 run/repository 展开的五维分数 | 否 | 是 |
| `repo_analyses` | 按 run/repository 展开的分析、输入哈希和 provider 轨迹 | 否 | 是 |
| `recommendations` | 按 run/rank 展开的推荐索引 | 否 | 是 |

后三张表只用于 SQL 统计、审计和以后离线分析，是 `radar_runs.recommendations` 的派生投影，不拥有业务真相。

## 写入原子性

配置 PostgreSQL 时，`saveRadarRun()` 在同一事务中完成：

1. 插入或更新 `radar_runs` 快照；
2. 删除该 `run_id` 的旧投影；
3. 用 `github_id` upsert `repositories`，取得数据库内部 `repositories.id`；
4. 重建 `repo_scores`、`repo_analyses` 和 `recommendations`。

任一步失败都会回滚整个事务。投影中的 `repo_id` 必须使用数据库内部 ID，禁止直接写 GitHub ID。

本地 JSON 模式只保存 `radar_runs.json`，不模拟三张 SQL 投影表；这样本地和生产仍共享同一个运行时读取语义。

## 一致性约束

- `radar_runs.recommendation_count` 必须等于快照数组长度。
- 同一 run 中 repository ID 和 rank 必须唯一。
- `repo_scores`、`repo_analyses`、`recommendations` 的行数必须与该 run 推荐数一致。
- 分析输入哈希包含仓库证据、规则评分和本次公共雷达偏好快照。
- Prompt 或 Schema 改动时必须同步提升 `repositoryAnalysisPromptVersion` 或 `repositoryAnalysisSchemaVersion`。

## 迁移与重建

部署新数据库或升级现有数据库后执行：

```bash
pnpm db:migrate
pnpm db:rebuild-radar-projections
```

第二条命令只读取 `radar_runs` 并幂等重建派生投影，不调用 GitHub 或 DeepSeek。没有 `DATABASE_URL` 时会安全跳过。
