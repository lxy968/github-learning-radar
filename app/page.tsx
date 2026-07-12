import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { RadarRefreshButton } from "@/components/radar-refresh-button";
import { RecommendationCard } from "@/components/recommendation-card";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getPublicRadarPreference, getUserPreference } from "@/lib/preferences";
import { getCurrentRecommendations, getRadarStats } from "@/lib/radar";
import { getCurrentAnonymousUserId } from "@/lib/anonymous-session";
import { getLatestRadarRun } from "@/lib/radar-runs";
import { getRefreshScheduleDecision } from "@/lib/refresh-schedule";
import { formatNumber } from "@/lib/utils";
import { listCurrentDetailedStudyPlans } from "@/lib/detailed-study-plans";
import type { RadarCategory, RefreshInterval } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await getCurrentAnonymousUserId();
  const [latestRun, preference, publicRadarPreference] = await Promise.all([
    getLatestRadarRun(),
    getUserPreference(userId),
    getPublicRadarPreference()
  ]);
  const recommendations = await getCurrentRecommendations(preference);
  const detailedPlans = await listCurrentDetailedStudyPlans(recommendations, preference);
  const stats = getRadarStats(recommendations);
  const planRepoIds = new Set(detailedPlans.map((plan) => plan.repoId));
  const refreshSchedule = getRefreshScheduleDecision(latestRun, publicRadarPreference.refreshInterval);

  return (
    <AppShell>
      <PageHeader
        eyebrow={latestRun ? `运行记录 · ${latestRun.date}` : "种子推荐"}
        title="今日 GitHub 学习雷达"
        description="把候选仓库压缩成可学习、可复刻、可行动的项目列表。先看清项目做什么，再决定要不要进入详情拆学习路线。"
        actions={
          <>
            <Badge tone={latestRun?.source === "github" ? "green" : "amber"}>
              {latestRun ? `${formatRunSource(latestRun.source)} · ${formatRunStatus(latestRun.status)}` : "种子数据"}
            </Badge>
            {process.env.NODE_ENV !== "production" ? <RadarRefreshButton /> : null}
          </>
        }
      />

      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_320px] lg:px-8">
        <section className="grid gap-4">
          {recommendations.map((item) => (
            <RecommendationCard key={item.repo.id} item={item} hasStudyPlan={planRepoIds.has(item.repo.id)} />
          ))}
        </section>

        <aside className="grid content-start gap-4">
          <Panel className="p-5">
            <div className="flex items-center gap-2 text-teal-700">
              <Sparkles size={16} />
              <h2 className="text-sm font-semibold text-slate-950">今日推荐</h2>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <CompactStat label="项目" value={stats.projectCount} />
              <CompactStat label="平均分" value={stats.avgScore} />
              <CompactStat label="主方向" value={formatCategory(stats.topCategory)} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              已按你的兴趣重新排序 · 周新增 {formatNumber(stats.totalWeeklyStars)} stars
            </p>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center gap-2">
              {latestRun?.status === "success" ? (
                <CheckCircle2 size={16} className="text-emerald-600" />
              ) : (
                <Clock3 size={16} className="text-amber-600" />
              )}
              <h2 className="text-sm font-semibold text-slate-950">雷达状态</h2>
            </div>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">更新时间</dt>
                <dd className="mt-1 font-medium text-slate-800">
                  {latestRun ? new Date(latestRun.finishedAt).toLocaleString("zh-CN") : "等待第一次运行"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">数据完整性</dt>
                <dd className="mt-1 font-medium text-slate-800">
                  {latestRun ? `${formatRunSource(latestRun.source)} · ${formatRunStatus(latestRun.status)}` : "种子推荐"}
                </dd>
              </div>
            </dl>

            <details className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
              <summary className="focus-ring cursor-pointer rounded-sm py-1 font-medium">运行与个性化详情</summary>
              <div className="mt-3 grid gap-2 text-xs leading-5">
                {latestRun ? (
                  <>
                    <p>候选 {latestRun.rawCandidateCount} 个 · 推荐 {latestRun.recommendationCount} 个</p>
                    <p>AI：{formatAiRunStatus(latestRun.notes)}</p>
                  </>
                ) : null}
                <p>公共抓取：每{formatRefreshInterval(publicRadarPreference.refreshInterval)}</p>
                <p>下次状态：{formatNextRefresh(refreshSchedule)}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {preference.languages.map((item) => (
                    <Badge key={item} tone="blue">{item}</Badge>
                  ))}
                </div>
              </div>
            </details>

            <Link href="/settings" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-700">
              调整兴趣偏好 <ArrowRight size={14} />
            </Link>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}

function CompactStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-3">
      <div className="text-base font-semibold text-slate-950">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function formatRunSource(source: "seed" | "github") {
  return source === "github" ? "GitHub 抓取" : "种子数据";
}

function formatRunStatus(status: string) {
  if (status === "success") return "成功";
  if (status === "partial") return "部分成功";
  return "失败";
}

function formatRefreshInterval(value: RefreshInterval) {
  if (value === "three-days") return "三天";
  if (value === "weekly") return "一周";
  if (value === "monthly") return "一个月";
  if (value === "never") return "永不";
  return "一天";
}

function formatNextRefresh(decision: ReturnType<typeof getRefreshScheduleDecision>) {
  if (!decision.nextSuggestedRefreshAt) return decision.shouldRun ? "等待第一次运行" : "已关闭";
  if (decision.shouldRun) return "已到时间，等待下一次定时检查";
  return new Date(decision.nextSuggestedRefreshAt).toLocaleString("zh-CN");
}

function formatAiRunStatus(notes: string[]) {
  const fallbackReasons = notes.find(
    (note) => note.startsWith("DeepSeek fallback reasons:") || note.startsWith("AI fallback reasons:")
  );
  if (fallbackReasons) {
    const firstFailure = fallbackReasons
      .replace("DeepSeek fallback reasons:", "")
      .replace("AI fallback reasons:", "")
      .trim()
      .split(" | ")[0];
    const separator = firstFailure.indexOf(": ");
    const reason = separator >= 0 ? firstFailure.slice(separator + 2) : firstFailure;
    return `已使用规则 fallback（${reason.slice(0, 90)}）`;
  }

  if (notes.some((note) => note.includes("DeepSeek is not configured") || note.includes("AI provider is not configured"))) {
    return "未配置 DeepSeek，已使用规则 fallback";
  }

  return "DeepSeek 分析已完成";
}

function formatCategory(value: RadarCategory | "none") {
  if (value === "none") return "暂无";

  const labels: Record<RadarCategory, string> = {
    "ai-app": "AI 应用",
    frontend: "前端",
    backend: "后端",
    devtool: "开发者工具",
    database: "数据库",
    automation: "自动化",
    cli: "CLI",
    fullstack: "全栈"
  };

  return labels[value] ?? value;
}
