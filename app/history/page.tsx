import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getRecommendations } from "@/lib/radar";
import { listRadarRuns } from "@/lib/radar-runs";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const runs = await listRadarRuns();
  const seedItems = getRecommendations();

  return (
    <AppShell>
      <PageHeader
        eyebrow="History"
        title="历史雷达"
        description="每次刷新或定时任务都会沉淀为一条雷达运行记录，避免好项目从信息流里消失。"
      />
      <div className="grid gap-4 px-5 py-5 lg:px-8">
        {runs.length > 0 ? (
          runs.map((run) => (
            <Panel key={run.runId} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={run.source === "github" ? "green" : "amber"}>{run.date}</Badge>
                <Badge>{run.source}</Badge>
                <span className="text-sm text-slate-600">
                  {run.recommendationCount} 个推荐，{run.rawCandidateCount} 个候选
                </span>
              </div>
              {run.metrics ? (
                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md bg-slate-50 px-3 py-2">
                    GitHub 查询失败：{run.metrics.discoveryFailureCount}/{run.metrics.discoveryQueryCount}
                  </div>
                  <div className="rounded-md bg-slate-50 px-3 py-2">
                    DeepSeek 成功：{run.metrics.aiSuccessCount}/{run.metrics.aiRequestedCount}
                  </div>
                  <div className="rounded-md bg-slate-50 px-3 py-2">DeepSeek fallback：{run.metrics.aiFallbackCount}</div>
                  <div className="rounded-md bg-slate-50 px-3 py-2">
                    DeepSeek Token：{run.metrics.totalTokens.toLocaleString("zh-CN")}
                  </div>
                </div>
              ) : null}
              <div className="mt-4 grid gap-2 text-sm text-slate-700">
                {run.recommendations.slice(0, 5).map((item) => (
                  <div key={item.repo.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>{item.repo.fullName}</span>
                    <span className="font-medium text-teal-700">{item.score.finalScore}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ))
        ) : (
          <Panel className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="amber">Seed</Badge>
              <span className="text-sm text-slate-600">{seedItems.length} 个项目，等待第一次每日任务运行</span>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-slate-700">
              {seedItems.slice(0, 5).map((item) => (
                <div key={item.repo.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span>{item.repo.fullName}</span>
                  <span className="font-medium text-teal-700">{item.score.finalScore}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
