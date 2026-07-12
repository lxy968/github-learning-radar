"use client";

import { Check, ChevronDown, Clipboard, Clock3, FileCode2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  UserPreference
} from "@/lib/types";

const durationOptions: Array<{ duration: DetailedStudyPlanDuration; label: string; description: string }> = [
  { duration: 3, label: "3 天", description: "快速跑通主流程" },
  { duration: 7, label: "7 天", description: "完成可演示版本" },
  { duration: 14, label: "14 天", description: "包含测试与交付" }
];

type GenerateResponse = {
  status: "success" | "error";
  cached?: boolean;
  message?: string;
  detail?: string;
  plan?: DetailedStudyPlan;
};

export function DetailedStudyPlanBuilder({
  owner,
  repo,
  projectName,
  language,
  cloneGoal,
  learnerLevel,
  learnerGoal,
  initialPlans
}: {
  owner: string;
  repo: string;
  projectName: string;
  language: string;
  cloneGoal: string;
  learnerLevel: Difficulty;
  learnerGoal: UserPreference["goal"];
  initialPlans: DetailedStudyPlan[];
}) {
  const initialByDuration = useMemo(() => indexPlans(initialPlans), [initialPlans]);
  const [plans, setPlans] = useState<Partial<Record<DetailedStudyPlanDuration, DetailedStudyPlan>>>(initialByDuration);
  const [duration, setDuration] = useState<DetailedStudyPlanDuration>(initialPlans[0]?.duration ?? 3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activePlan = plans[duration];

  async function generate(force = false) {
    setIsGenerating(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/study-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, duration, force })
      });
      const payload = (await response.json()) as GenerateResponse;

      if (!response.ok || payload.status !== "success" || !payload.plan) {
        throw new Error(payload.detail || payload.message || "详细学习方案生成失败。 ");
      }

      setPlans((current) => ({ ...current, [duration]: payload.plan }));
      setMessage(payload.message ?? "详细学习方案已生成。 ");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "详细学习方案生成失败。 ");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Panel className="p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{language}</Badge>
              <Badge>{projectName}</Badge>
              <Badge tone="green">仅分析当前仓库</Badge>
              <Badge>{levelLabel(learnerLevel)}</Badge>
              <Badge>{goalLabel(learnerGoal)}</Badge>
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-950">选择学习周期</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{cloneGoal}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              缓存会同时校验仓库输入、学习水平、目标、提示词/Schema 版本和 DeepSeek 模型。切换周期不会自动调用模型。
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-end">
            {activePlan ? (
              <Button variant="secondary" onClick={() => generate(true)} disabled={isGenerating}>
                <RefreshCw size={15} className={isGenerating ? "animate-spin" : ""} />
                {isGenerating ? "正在生成" : "重新生成"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => generate(false)} disabled={isGenerating}>
                <Sparkles size={15} className={isGenerating ? "animate-pulse" : ""} />
                {isGenerating ? "正在生成具体步骤…" : `生成 ${duration} 天详细方案`}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {durationOptions.map((option) => {
            const cachedPlan = plans[option.duration];
            const active = duration === option.duration;

            return (
              <button
                type="button"
                key={option.duration}
                onClick={() => {
                  setDuration(option.duration);
                  setMessage("");
                  setError("");
                }}
                className={cn(
                  "focus-ring rounded-md border px-4 py-3 text-left transition",
                  active ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-slate-50 hover:bg-white"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-sm font-semibold", active ? "text-teal-900" : "text-slate-800")}>
                    {option.label}
                  </span>
                  {cachedPlan ? <span className="text-xs font-medium text-teal-700">已生成</span> : null}
                </div>
                <div className="mt-1 text-xs text-slate-500">{option.description}</div>
              </button>
            );
          })}
        </div>

        {message ? <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
        {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      </Panel>

      {activePlan ? (
        <DetailedPlanChecklist plan={activePlan} />
      ) : (
        <Panel className="p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <Sparkles size={20} />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-950">还没有 {duration} 天详细方案</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            点击生成后，每一步都会包含具体操作、仓库证据、验证方法、交付物和预计耗时。DeepSeek 不可用时也会生成规则方案。
          </p>
          <Button className="mt-5" variant="primary" onClick={() => generate(false)} disabled={isGenerating}>
            <Sparkles size={15} className={isGenerating ? "animate-pulse" : ""} />
            {isGenerating ? "正在生成具体步骤…" : `生成 ${duration} 天详细方案`}
          </Button>
        </Panel>
      )}
    </div>
  );
}

function DetailedPlanChecklist({ plan }: { plan: DetailedStudyPlan }) {
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

  useEffect(() => {
    if (current) setActiveDay(current.day.day);
    else if (plan.days.length > 0) setActiveDay(plan.days[plan.days.length - 1].day);
  }, [current?.step.id, plan]);

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
              <Badge tone={plan.source === "ai" ? "blue" : "amber"}>
                {plan.source === "ai" ? "DeepSeek 生成" : "规则生成"}
              </Badge>
              <Badge>{plan.duration} 天</Badge>
              {plan.modelId ? <Badge>{plan.modelId}</Badge> : null}
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-950">具体学习方案</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{plan.summary}</p>
            {plan.fallbackReason ? (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {plan.fallbackReason === "not-configured"
                  ? "未配置 DeepSeek，本次没有发起模型调用，正在使用可执行的规则方案。"
                  : `DeepSeek 调用失败，正在使用可执行的规则方案${plan.errorSummary ? `：${plan.errorSummary}` : "。"}`}
              </p>
            ) : null}
          </div>
          <Button variant="secondary" onClick={copyMarkdown}>
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
            {copied ? "已复制" : "复制 Markdown"}
          </Button>
        </div>

        <div className="mt-5 grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md bg-slate-50 px-3 py-2">
            方案来源：{plan.source === "ai" ? `${plan.provider ?? "DeepSeek"} / ${plan.modelId ?? "默认模型"}` : "规则生成"}
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
