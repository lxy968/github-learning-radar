"use client";

import { Check, ChevronDown, Clipboard, Clock3, FileCode2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { getDetailedStudyPlanSteps, getDetailedStudyPlanStorageKey } from "@/lib/detailed-study-progress";
import { cn } from "@/lib/utils";
import { useSyncedProgress } from "@/lib/use-synced-progress";
import type {
  DetailedStudyPlan,
  DetailedStudyPlanDuration,
  DetailedStudyStep,
  Difficulty,
  JobRunStatus,
  UserPreference
} from "@/lib/types";

const durationOptions: Array<{ duration: DetailedStudyPlanDuration; label: string; description: string }> = [
  { duration: 3, label: "3 天", description: "快速跑通主流程" },
  { duration: 7, label: "7 天", description: "完成可演示版本" },
  { duration: 14, label: "14 天", description: "包含测试与交付" }
];

type PublicStudyPlanJob = {
  runId: string;
  status: JobRunStatus;
  stage: string | null;
  progress: { completed: number; total: number };
  summary: Record<string, unknown>;
  errorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  duration: DetailedStudyPlanDuration | null;
  repoFullName: string | null;
};

type StudyPlanResponse = {
  status: "success" | "error";
  queued?: boolean;
  cached?: boolean;
  message?: string;
  detail?: string;
  plan?: DetailedStudyPlan;
  plans?: DetailedStudyPlan[];
  job?: PublicStudyPlanJob | null;
};

export function DetailedStudyPlanBuilder({
  owner,
  repo,
  projectName,
  language,
  cloneGoal,
  learnerLevel,
  learnerGoal,
  initialPlans,
  showcaseMode = false
}: {
  owner: string;
  repo: string;
  projectName: string;
  language: string;
  cloneGoal: string;
  learnerLevel: Difficulty;
  learnerGoal: UserPreference["goal"];
  initialPlans: DetailedStudyPlan[];
  showcaseMode?: boolean;
}) {
  const initialByDuration = useMemo(() => indexPlans(initialPlans), [initialPlans]);
  const [plans, setPlans] = useState<Partial<Record<DetailedStudyPlanDuration, DetailedStudyPlan>>>(initialByDuration);
  const [selectedDuration, setSelectedDuration] = useState<DetailedStudyPlanDuration>(initialPlans[0]?.duration ?? 3);
  const [activeJob, setActiveJob] = useState<PublicStudyPlanJob | null>(null);
  const [messages, setMessages] = useState<Partial<Record<DetailedStudyPlanDuration, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<DetailedStudyPlanDuration, string>>>({});
  const selectedPlan = plans[selectedDuration];

  const applyResponse = useCallback((payload: StudyPlanResponse) => {
    if (payload.plans) setPlans(indexPlans(payload.plans));
    if (payload.plan) setPlans((current) => ({ ...current, [payload.plan!.duration]: payload.plan }));
    if (payload.job && payload.job.duration) {
      const duration = payload.job.duration;
      const belongsToCurrentRepo = payload.job.repoFullName === projectName;
      if (payload.job.status === "queued" || payload.job.status === "running") {
        setActiveJob(payload.job);
        if (belongsToCurrentRepo) {
          setMessages((current) => ({ ...current, [duration]: formatStudyPlanJobMessage(payload.job!) }));
        }
        writeStoredStudyPlanJob(payload.job.runId);
      } else {
        setActiveJob(null);
        removeStoredStudyPlanJob();
        if (payload.job.status === "success") {
          setMessages((current) => ({ ...current, [duration]: "方案已经全部生成完成。" }));
          setErrors((current) => ({ ...current, [duration]: "" }));
        } else {
          setErrors((current) => ({
            ...current,
            [duration]: payload.job?.errorSummary ?? (payload.job?.status === "cancelled" ? "任务已停止。" : "方案只完成了部分阶段。")
          }));
        }
      }
    } else if (payload.job === null) {
      setActiveJob(null);
      removeStoredStudyPlanJob();
    }
  }, [projectName]);

  const syncJobState = useCallback(async () => {
    const storedRunId = readStoredStudyPlanJob();
    const query = storedRunId
      ? `runId=${encodeURIComponent(storedRunId)}`
      : `owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;
    try {
      const response = await fetch(`/api/study-plans?${query}`, { cache: "no-store" });
      const payload = (await response.json()) as StudyPlanResponse;
      if (!response.ok || payload.status !== "success") throw new Error(payload.message ?? "无法读取方案任务状态。");
      applyResponse(payload);
    } catch {
      if (activeJob?.duration) {
        setMessages((current) => ({ ...current, [activeJob.duration!]: "任务状态暂时不可用，仍会继续尝试查询。" }));
      }
    }
  }, [activeJob?.duration, applyResponse, owner, repo]);

  useEffect(() => {
    if (showcaseMode) {
      removeStoredStudyPlanJob();
      return;
    }
    void syncJobState();
  }, [showcaseMode, syncJobState]);

  useEffect(() => {
    if (showcaseMode) return;
    if (!activeJob || (activeJob.status !== "queued" && activeJob.status !== "running")) return;
    const interval = window.setInterval(() => void syncJobState(), 1500);
    return () => window.clearInterval(interval);
  }, [activeJob, showcaseMode, syncJobState]);

  async function generate(duration: DetailedStudyPlanDuration) {
    if (showcaseMode) return;
    setSelectedDuration(duration);
    setMessages((current) => ({ ...current, [duration]: "正在创建后台任务……" }));
    setErrors((current) => ({ ...current, [duration]: "" }));

    try {
      const response = await fetch("/api/study-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, duration })
      });
      const payload = (await response.json()) as StudyPlanResponse;

      if (!response.ok || payload.status !== "success") {
        throw new Error(payload.detail || payload.message || "详细学习方案任务创建失败。");
      }
      applyResponse(payload);
      setMessages((current) => ({ ...current, [duration]: payload.message ?? "后台任务已创建。" }));
    } catch (caught) {
      setErrors((current) => ({ ...current, [duration]: caught instanceof Error ? caught.message : "任务创建失败。" }));
    }
  }

  return (
    <div className="grid gap-5">
      <Panel className="p-5">
        <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{language}</Badge>
              <Badge>{projectName}</Badge>
              <Badge tone="green">仅分析当前仓库</Badge>
              <Badge>{levelLabel(learnerLevel)}</Badge>
              <Badge>{goalLabel(learnerGoal)}</Badge>
              {showcaseMode ? <Badge tone="amber">作品集预置体验</Badge> : null}
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-950">选择一个学习周期</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{cloneGoal}</p>
            {showcaseMode ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                这是公开演示站：推荐和学习方案会提前准备好。你可以浏览、勾选步骤并刷新查看进度；本站不会现场调用 DeepSeek，也不会产生模型费用。想生成自己的方案，请 Fork 仓库，在你自己的部署中填写 DeepSeek Key。
              </p>
            ) : (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                3 天、7 天和 14 天都会一次生成完整方案。同一时间只运行一个后台任务，刷新页面也能找回状态。
              </p>
            )}
        </div>

        {showcaseMode && initialPlans.length === 0 ? (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
            <h3 className="text-sm font-semibold text-slate-950">该项目的公开演示方案正在准备中</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">你可以先查看其他推荐项目；公开站不会为了补齐内容而现场调用模型。</p>
            <Link href="/#today-recommendations" className="focus-ring mt-4 inline-flex rounded-md text-sm font-medium text-teal-700">
              返回今日推荐
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {durationOptions.map((option) => {
              const plan = plans[option.duration];
              return (
                <StudyPlanOptionCard
                  key={option.duration}
                  option={option}
                  plan={plan}
                  selected={selectedDuration === option.duration}
                  activeJob={activeJob}
                  currentRepoFullName={projectName}
                  message={messages[option.duration]}
                  error={errors[option.duration]}
                  showcaseMode={showcaseMode}
                  onSelect={() => setSelectedDuration(option.duration)}
                  onGenerate={() => generate(option.duration)}
                />
              );
            })}
          </div>
        )}
      </Panel>

      {selectedPlan ? (
        <DetailedPlanChecklist
          plan={selectedPlan}
          generationActive={activeJob?.duration === selectedPlan.duration}
          showcaseMode={showcaseMode}
        />
      ) : showcaseMode ? null : (
        <Panel className="p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <Sparkles size={20} />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-950">还没有 {selectedDuration} 天详细方案</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {showcaseMode
              ? "这个周期暂时没有预置方案。公开作品集不会现场生成；请选择已有方案，或 Fork 后在自己的 full 部署中启用生成。"
              : "请在上方对应卡片中启动后台生成。任务完成后，这里会一次显示全部天数和具体步骤。"}
          </p>
        </Panel>
      )}
    </div>
  );
}

function StudyPlanOptionCard({
  option,
  plan,
  selected,
  activeJob,
  currentRepoFullName,
  message,
  error,
  showcaseMode,
  onSelect,
  onGenerate
}: {
  option: (typeof durationOptions)[number];
  plan?: DetailedStudyPlan;
  selected: boolean;
  activeJob: PublicStudyPlanJob | null;
  currentRepoFullName: string;
  message?: string;
  error?: string;
  showcaseMode: boolean;
  onSelect: () => void;
  onGenerate: () => void;
}) {
  const jobActive = activeJob?.status === "queued" || activeJob?.status === "running";
  const ownsJob = jobActive && activeJob?.repoFullName === currentRepoFullName && activeJob?.duration === option.duration;
  const generatedThroughDay = plan?.generatedThroughDay ?? (plan ? Math.max(0, ...plan.days.map((day) => day.day)) : 0);
  const complete = Boolean(plan && generatedThroughDay >= option.duration);
  const progressCompleted = ownsJob ? activeJob.progress.completed : generatedThroughDay;
  const progressPercent = Math.round((Math.min(option.duration, progressCompleted) / option.duration) * 100);
  const statusLabel = showcaseMode
    ? complete
      ? "可体验"
      : plan
        ? `预置到 Day ${generatedThroughDay}`
        : "未预置"
    : complete
      ? "已完成"
      : generatedThroughDay > 0
        ? `到 Day ${generatedThroughDay}`
        : "未生成";

  return (
    <article className={cn("rounded-lg border p-4", selected ? "border-teal-500 bg-teal-50/60" : "border-slate-200 bg-white")}>
      <button type="button" className="focus-ring w-full rounded-md text-left" onClick={onSelect}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-slate-950">{option.label}</span>
          <Badge tone={complete ? "green" : generatedThroughDay > 0 ? "blue" : "neutral"}>
            {statusLabel}
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{option.description}</p>
      </button>

      {!showcaseMode || plan ? <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{ownsJob ? "后台生成进度" : showcaseMode ? "预置内容" : "已保存内容"}</span>
          <span>{progressCompleted}/{option.duration} 天</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      </div> : null}

      {ownsJob ? (
        <div className="mt-3">
          <p className="rounded-md bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900" aria-live="polite">
            {message ?? formatStudyPlanJobMessage(activeJob)}
          </p>
        </div>
      ) : showcaseMode ? null : (
        <Button
          className="mt-3 h-auto min-h-10 w-full whitespace-normal py-2 text-center leading-5"
          variant={complete || showcaseMode ? "secondary" : "primary"}
          onClick={onGenerate}
          disabled={jobActive || complete}
        >
          <Sparkles size={15} />
          {jobActive
            ? "请等待当前任务"
            : complete
              ? "已有方案可用"
              : "开始后台生成"}
        </Button>
      )}

      {message && !ownsJob ? <p className="mt-2 text-xs leading-5 text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</p> : null}
    </article>
  );
}

function DetailedPlanChecklist({
  plan,
  generationActive,
  showcaseMode
}: {
  plan: DetailedStudyPlan;
  generationActive: boolean;
  showcaseMode: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [activeDay, setActiveDay] = useState(plan.days[0]?.day ?? 1);
  const storageKey = getDetailedStudyPlanStorageKey(plan.id);
  const steps = useMemo(() => getDetailedStudyPlanSteps(plan), [plan]);
  const { completed, toggleStep: toggleSyncedStep, syncState } = useSyncedProgress({
    planId: `detailed:${plan.id}`,
    storageKey,
    stepIds: steps.map((step) => step.id)
  });
  const completedCount = steps.filter((step) => completed[step.id]).length;
  const percent = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;
  const markdown = useMemo(() => toMarkdown(plan), [plan]);
  const stepContexts = useMemo(
    () => plan.days.flatMap((day) => day.steps.map((step) => ({ day, step }))),
    [plan]
  );
  const currentIndex = stepContexts.findIndex(({ step }) => !completed[step.id]);
  const current = currentIndex >= 0 ? stepContexts[currentIndex] : null;
  const next = currentIndex >= 0 ? stepContexts[currentIndex + 1] ?? null : null;
  const generatedThroughDay = plan.generatedThroughDay ?? Math.max(0, ...plan.days.map((day) => day.day));
  const isPartial = generatedThroughDay < plan.duration;

  useEffect(() => {
    if (current) setActiveDay(current.day.day);
    else if (plan.days.length > 0) setActiveDay(plan.days[plan.days.length - 1].day);
  }, [current?.step.id, plan.id, plan.days.length]);

  function toggleStep(stepId: string) {
    toggleSyncedStep(stepId);
    window.dispatchEvent(new CustomEvent("detailed-study-progress"));
  }

  function completeCurrentAndContinue() {
    if (!current) return;
    toggleStep(current.step.id);
    if (next) {
      window.setTimeout(() => {
        document.getElementById(`step-${next.step.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    }
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <>
      <Panel className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={showcaseMode ? "blue" : plan.source === "ai" ? "blue" : plan.source === "mixed" ? "green" : "amber"}>
                {showcaseMode ? "预置演示方案" : plan.source === "ai" ? "智能生成" : plan.source === "mixed" ? "智能生成 + 临时方案" : "临时规则方案"}
              </Badge>
              <Badge>{plan.duration} 天</Badge>
              <Badge>{isPartial ? `旧方案仅到 Day ${generatedThroughDay}` : "完整方案"}</Badge>
              {!showcaseMode && plan.source === "rule" && plan.modelId ? <Badge>智能生成未完成</Badge> : null}
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-950">具体学习方案</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{plan.summary}</p>
            {!showcaseMode && plan.fallbackReason ? (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {plan.source === "mixed"
                  ? "这是旧版混合方案，其中包含临时规则内容；建议重新生成一次完整方案。"
                  : plan.fallbackReason === "not-configured"
                  ? "未配置智能生成服务，本次没有发起模型调用，正在使用可执行的规则方案。"
                  : `智能生成未完成，当前显示临时起步方案${plan.errorSummary ? `：${plan.errorSummary}` : "。"}`}
              </p>
            ) : null}
            {isPartial ? (
              <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-3">
                <p className="text-xs leading-5 text-blue-900">
                  {showcaseMode
                    ? `这是旧版未完成方案，仅保存到 Day ${generatedThroughDay}；作品集版不会现场补生成。`
                    : generationActive
                    ? `正在重新生成完整的 ${plan.duration} 天方案。当前旧内容仍可查看，完成后会整体替换。`
                    : `这是旧版未完成方案，仅保存到 Day ${generatedThroughDay}。请在上方重新生成完整方案。`}
                </p>
              </div>
            ) : null}
          </div>
          <Button variant="secondary" onClick={copyMarkdown}>
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
            {copied ? "已复制" : "复制 Markdown"}
          </Button>
        </div>

        <div className="mt-5 grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md bg-slate-50 px-3 py-2">
            方案来源：{plan.source === "ai" ? "智能生成" : plan.source === "mixed" ? "智能生成与临时规则内容" : "临时规则内容"}
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            缓存依据：仓库更新于 {new Date(plan.basedOnPushedAt).toLocaleDateString("zh-CN")}
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            生成时间：{new Date(plan.generatedAt).toLocaleString("zh-CN")}
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            缓存版本：{plan.cache ? `${plan.cache.promptVersion} · ${plan.cache.inputHash.slice(0, 8)}` : "旧方案，不会自动复用"}
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-900">开始前准备</h3>
          <ul className="mt-2 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            {plan.prerequisites.map((item, index) => (
              <li key={`prerequisite-${index}-${item}`} className="rounded-md bg-slate-50 px-3 py-2">
                {item}
              </li>
            ))}
          </ul>
        </div>

        {plan.glossary?.length ? (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-900">术语白话解释</h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {plan.glossary.map((item) => (
                <div key={item.term} className="rounded-md bg-blue-50 px-3 py-2 text-sm leading-6">
                  <dt className="font-semibold text-blue-950">{item.term}</dt>
                  <dd className="text-blue-900">{item.explanation}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </Panel>

      <Panel className="sticky top-16 z-20 border-teal-100 bg-white/95 p-4 shadow-md backdrop-blur lg:top-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
              <span>总进度 {completedCount}/{steps.length}</span>
              <span>{percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="学习方案总进度">
              <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-3 flex items-start gap-2">
              <span className="mt-0.5 rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">
                {current ? `Day ${current.day.day}` : "已完成"}
              </span>
              <div className="min-w-0">
                <div className="text-xs text-slate-500">当前任务</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                  {current?.step.title ?? "全部步骤已经完成"}
                </div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
            <Button
              className="min-h-11 px-4"
              variant="primary"
              onClick={completeCurrentAndContinue}
              disabled={!current}
            >
              <Check size={16} />
              {current ? (next ? "完成并进入下一步" : "完成最后一步") : "方案已完成"}
            </Button>
            <span className="text-center text-[11px] text-slate-400 sm:text-right">
              {syncState === "synced" ? "匿名会话已同步 · 本机保留离线副本" : syncState === "offline" ? "离线保存 · 联网后自动同步" : "正在同步进度"}
            </span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5">
        {plan.days.map((day) => {
          const dayDone = day.steps.filter((step) => completed[step.id]).length;
          const expanded = activeDay === day.day;
          const currentDay = current?.day.day === day.day;
          const dayComplete = dayDone === day.steps.length;

          return (
            <Panel key={`day-${day.day}`} className={cn("overflow-hidden p-0", currentDay && "border-teal-200")}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`day-panel-${day.day}`}
                onClick={() => setActiveDay(day.day)}
                className="focus-ring flex min-h-16 w-full items-start justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-teal-700">Day {day.day}</span>
                    {currentDay ? <Badge tone="blue">当前</Badge> : dayComplete ? <Badge tone="green">已完成</Badge> : null}
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-slate-950">{day.goal}</h2>
                  {!expanded ? <p className="mt-1 truncate text-xs text-slate-500">完成结果：{day.outcome}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={dayComplete ? "green" : dayDone > 0 ? "blue" : "neutral"}>
                    {dayDone}/{day.steps.length}
                  </Badge>
                  <ChevronDown aria-hidden="true" size={17} className={cn("text-slate-400 transition", expanded && "rotate-180")} />
                </div>
              </button>

              {expanded ? (
                <div id={`day-panel-${day.day}`} className="border-t border-slate-100 px-5 pb-5 pt-4">
                  <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
                    完成结果：{day.outcome}
                  </p>
                  <div className="grid gap-4">
                    {day.steps.map((step, index) => (
                      <DetailedStepCard
                        key={step.id}
                        step={step}
                        index={index}
                        done={Boolean(completed[step.id])}
                        current={current?.step.id === step.id}
                        onToggle={() => toggleStep(step.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

function levelLabel(level: Difficulty) {
  if (level === "beginner") return "入门";
  if (level === "advanced") return "进阶";
  return "中级";
}

function goalLabel(goal: UserPreference["goal"]) {
  if (goal === "portfolio") return "作品集";
  if (goal === "trend") return "趋势探索";
  if (goal === "source-reading") return "源码阅读";
  return "Mini 复刻";
}

function DetailedStepCard({
  step,
  index,
  done,
  current,
  onToggle
}: {
  step: DetailedStudyStep;
  index: number;
  done: boolean;
  current: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      id={`step-${step.id}`}
      className={cn(
        "scroll-mt-48 rounded-lg border p-4 transition",
        done ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-white",
        current && !done && "border-teal-400 ring-2 ring-teal-100"
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-pressed={done}
          aria-label={`${done ? "取消完成" : "标记完成"}：${step.title}`}
          onClick={onToggle}
          className={cn(
            "focus-ring -ml-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition",
            done ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-transparent"
          )}
        >
          <Check size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                步骤 {index + 1}
                {current && !done ? <span className="text-teal-700">· 当前任务</span> : null}
              </div>
              <h3 className={cn("mt-1 text-sm font-semibold", done ? "text-teal-950" : "text-slate-950")}>{step.title}</h3>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500">
              <Clock3 size={13} /> 约 {step.estimatedMinutes} 分钟
            </span>
          </div>

          <p className="mt-2 text-sm leading-6 text-slate-600">目的：{step.purpose}</p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">具体操作</h4>
              <ol className="mt-2 grid gap-2 text-sm leading-6 text-slate-700">
                {step.actions.map((action, actionIndex) => (
                  <li key={`action-${actionIndex}-${action}`} className="flex gap-2">
                    <span className="font-semibold text-teal-700">{actionIndex + 1}.</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">文件、目录或命令依据</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {step.references.map((reference, referenceIndex) => (
                  <span
                    key={`reference-${referenceIndex}-${reference}`}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                  >
                    <FileCode2 size={12} />
                    {reference}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-900">
              <span className="font-semibold">完成标准：</span>
              {step.verification}
            </div>
            <div className="rounded-md bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">
              <span className="font-semibold">交付物：</span>
              {step.deliverable}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function indexPlans(plans: DetailedStudyPlan[]) {
  return Object.fromEntries(plans.map((plan) => [plan.duration, plan])) as Partial<
    Record<DetailedStudyPlanDuration, DetailedStudyPlan>
  >;
}

const studyPlanJobStorageKey = "github-learning-radar:active-study-plan-job";

function writeStoredStudyPlanJob(runId: string) {
  try {
    window.sessionStorage.setItem(studyPlanJobStorageKey, runId);
  } catch {
    // Server-side job lookup still restores the task when browser storage is unavailable.
  }
}

function readStoredStudyPlanJob() {
  try {
    return window.sessionStorage.getItem(studyPlanJobStorageKey)?.trim() || null;
  } catch {
    return null;
  }
}

function removeStoredStudyPlanJob() {
  try {
    window.sessionStorage.removeItem(studyPlanJobStorageKey);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function formatStudyPlanJobMessage(job: PublicStudyPlanJob) {
  if (job.status === "queued") return "正在等待后台任务开始。";
  const stage = job.stage === "generating-full-plan" && job.duration
    ? `正在生成完整的 ${job.duration} 天方案`
    : "正在准备学习方案";
  const startedAt = job.startedAt ?? job.createdAt;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  return `${stage} · 已等待 ${formatElapsed(elapsedSeconds)}`;
}

function formatElapsed(totalSeconds: number) {
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  return `${Math.floor(totalSeconds / 60)} 分 ${totalSeconds % 60} 秒`;
}

function toMarkdown(plan: DetailedStudyPlan) {
  const lines = [
    `# ${plan.repoFullName} ${plan.duration} 天具体学习方案`,
    "",
    plan.summary,
    "",
    "## 开始前准备",
    ...plan.prerequisites.map((item) => `- ${item}`),
    ""
  ];

  for (const day of plan.days) {
    lines.push(`## Day ${day.day}: ${day.goal}`, "", `完成结果：${day.outcome}`, "");
    for (const step of day.steps) {
      lines.push(`### [ ] ${step.title}`, "", `目的：${step.purpose}`, "", "具体操作：");
      step.actions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
      lines.push(
        "",
        `依据：${step.references.join("、")}`,
        `完成标准：${step.verification}`,
        `交付物：${step.deliverable}`,
        `预计耗时：${step.estimatedMinutes} 分钟`,
        ""
      );
    }
  }

  return lines.join("\n");
}
