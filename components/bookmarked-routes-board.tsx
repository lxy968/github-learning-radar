"use client";

import Link from "next/link";
import { ArrowRight, Bookmark, GitFork, Sparkles, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getDetailedStudyPlanSteps, getDetailedStudyPlanStorageKey } from "@/lib/detailed-study-progress";
import { formatNumber } from "@/lib/utils";
import { synchronizeProgress } from "@/lib/use-synced-progress";
import type { DetailedStudyPlan, RadarRecommendation } from "@/lib/types";

type ProgressSummary = {
  label: string;
  done: number;
  total: number;
  ratio: number;
  plan: DetailedStudyPlan | null;
};

export function BookmarkedRoutesBoard({
  items,
  detailedPlans,
  showcaseMode = false
}: {
  items: RadarRecommendation[];
  detailedPlans: DetailedStudyPlan[];
  showcaseMode?: boolean;
}) {
  const [progressByRepo] = useStateFromItems(items, detailedPlans);

  const sortedItems = [...items].sort((a, b) => {
    const progressA = progressByRepo[a.repo.id] ?? getInitialProgress(a.repo.id, detailedPlans);
    const progressB = progressByRepo[b.repo.id] ?? getInitialProgress(b.repo.id, detailedPlans);

    if (progressB.ratio !== progressA.ratio) return progressB.ratio - progressA.ratio;
    if (progressB.done !== progressA.done) return progressB.done - progressA.done;
    return a.rank - b.rank;
  });

  if (items.length === 0) {
    return (
      <Panel className="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Bookmark size={20} />
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-950">还没有收藏项目的学习路线</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
          先在今日雷达里收藏项目，这里会按完成度展示你的学习路线进度。收藏页负责管理项目，这里负责继续学习。
        </p>
        <Link
          href="/"
          className="focus-ring mt-5 inline-flex h-9 items-center justify-center rounded-md border border-teal-700 bg-teal-700 px-3 text-sm font-medium text-white transition hover:border-teal-800 hover:bg-teal-800"
        >
          去今日雷达收藏项目
        </Link>
      </Panel>
    );
  }

  return (
    <div className="grid gap-5">
      <Panel className="p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">收藏项目学习队列</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              这里只展示你收藏的项目。完成度会与当前匿名会话同步，并按最高完成度从高到低排序。
            </p>
          </div>
          <Badge tone="green">{items.length} 个收藏项目</Badge>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        {sortedItems.map((item) => {
          const [owner, repo] = item.repo.fullName.split("/");
          const progress = progressByRepo[item.repo.id] ?? getInitialProgress(item.repo.id, detailedPlans);
          const percent = Math.round(progress.ratio * 100);
          const learningPlanHref = `/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/learning-plan`;

          return (
            <Panel key={item.repo.id} className="p-5">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={percent === 100 ? "green" : percent > 0 ? "blue" : "neutral"}>
                    {progress.plan ? `完成度 ${percent}%` : showcaseMode ? "未预置演示方案" : "尚未生成详细方案"}
                  </Badge>
                  <Badge>{progress.plan ? progress.label : showcaseMode ? "准备中" : progress.label}</Badge>
                  <Badge tone="blue">{item.repo.primaryLanguage}</Badge>
                </div>

                <div>
                  <h2 className="text-base font-semibold text-slate-950">
                    <Link href={`/projects/${owner}/${repo}`} className="hover:text-teal-700">
                      {item.repo.fullName}
                    </Link>
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.analysis.miniCloneScope.goal}</p>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>
                      {progress.plan
                        ? `已完成 ${progress.done}/${progress.total} 个步骤`
                        : showcaseMode
                          ? "有预置方案后即可记录具体步骤"
                          : "生成后开始记录具体步骤"}
                    </span>
                    <span>按完成度排行</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${percent}%` }} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <Star size={15} /> {formatNumber(item.repo.stars)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <GitFork size={15} /> {formatNumber(item.repo.forks)}
                  </span>
                  <Link href={`/projects/${owner}/${repo}`} className="font-medium text-teal-700 hover:text-teal-800">
                    查看项目详情
                  </Link>
                </div>
              </div>

              <div className="mt-5 rounded-md bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                    <Sparkles size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {progress.plan
                        ? `${progress.plan.duration} 天具体学习方案`
                        : showcaseMode
                          ? "公开演示方案准备中"
                          : "生成具体学习方案"}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {progress.plan
                        ? progress.plan.summary
                        : showcaseMode
                          ? "公开站不会现场生成；你仍可查看项目详情，或选择已有预置方案的推荐。"
                          : "按当前仓库的 README、技术栈和文件信号生成具体操作、验证标准与交付物。"}
                    </p>
                    <Link
                      href={learningPlanHref}
                      className="focus-ring mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800"
                    >
                      {progress.plan ? "继续学习" : showcaseMode ? "查看方案状态" : "去生成"}
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function useStateFromItems(items: RadarRecommendation[], detailedPlans: DetailedStudyPlan[]) {
  const [progressByRepo, setProgressByRepo] = useState<Record<number, ProgressSummary>>(() =>
    Object.fromEntries(items.map((item) => [item.repo.id, getInitialProgress(item.repo.id, detailedPlans)]))
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const progress = await readAllProgress(items, detailedPlans);
      if (active) setProgressByRepo(progress);
    };
    const handleRefresh = () => void refresh();
    void refresh();
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("detailed-study-progress", handleRefresh);

    return () => {
      active = false;
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("detailed-study-progress", handleRefresh);
    };
  }, [detailedPlans, items]);

  return [progressByRepo, setProgressByRepo] as const;
}

async function readAllProgress(items: RadarRecommendation[], detailedPlans: DetailedStudyPlan[]) {
  const entries = await Promise.all(
    items.map(async (item) => [item.repo.id, await readBestProgress(item.repo.id, detailedPlans)] as const)
  );
  return Object.fromEntries(entries);
}

async function readBestProgress(repoId: number, detailedPlans: DetailedStudyPlan[]): Promise<ProgressSummary> {
  const plans = detailedPlans.filter((plan) => plan.repoId === repoId);
  if (plans.length === 0) return getInitialProgress(repoId, detailedPlans);

  return (await Promise.all(plans.map(readProgressForPlan)))
    .sort((a, b) => {
      if (b.ratio !== a.ratio) return b.ratio - a.ratio;
      if (b.done !== a.done) return b.done - a.done;
      return b.plan!.generatedAt.localeCompare(a.plan!.generatedAt);
    })[0];
}

async function readProgressForPlan(plan: DetailedStudyPlan): Promise<ProgressSummary> {
  const steps = getDetailedStudyPlanSteps(plan);
  const storageKey = getDetailedStudyPlanStorageKey(plan.id);
  const { completed } = await synchronizeProgress({
    planId: `detailed:${plan.id}`,
    storageKey,
    stepIds: steps.map((step) => step.id)
  });
  const done = steps.filter((step) => completed[step.id]).length;

  return {
    label: `${plan.duration} 天`,
    done,
    total: steps.length,
    ratio: steps.length > 0 ? done / steps.length : 0,
    plan
  };
}

function getInitialProgress(repoId: number, detailedPlans: DetailedStudyPlan[]): ProgressSummary {
  const plan = detailedPlans.find((item) => item.repoId === repoId) ?? null;
  const total = plan ? getDetailedStudyPlanSteps(plan).length : 0;

  return {
    label: plan ? `${plan.duration} 天` : "待生成",
    done: 0,
    total,
    ratio: 0,
    plan
  };
}
