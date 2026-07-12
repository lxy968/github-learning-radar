"use client";

import { Check, Clipboard } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSyncedProgress } from "@/lib/use-synced-progress";
import type { LearningPlan, LearningPlanDay } from "@/lib/types";

export type PlanKey = "plan3Days" | "plan7Days" | "plan14Days";

export type PlanStep = {
  id: string;
  label: string;
  type: "task" | "deliverable";
};

export const planOptions: Array<{ key: PlanKey; label: string; days: number }> = [
  { key: "plan3Days", label: "3 天", days: 3 },
  { key: "plan7Days", label: "7 天", days: 7 },
  { key: "plan14Days", label: "14 天", days: 14 }
];

export function getLearningPlanStorageKey(projectName: string, planKey: PlanKey) {
  return `learning-plan:${projectName}:${planKey}`;
}

export function getLearningPlanSteps(day: LearningPlanDay): PlanStep[] {
  return [
    ...day.tasks.map((task, index) => ({
      id: `day-${day.day}-task-${index}`,
      label: task,
      type: "task" as const
    })),
    {
      id: `day-${day.day}-deliverable`,
      label: day.deliverable,
      type: "deliverable" as const
    }
  ];
}

export function LearningPlanSection({
  projectName,
  plan,
  compact = false,
  initialPlanKey,
  onProgressChange
}: {
  projectName: string;
  plan: LearningPlan;
  compact?: boolean;
  initialPlanKey?: PlanKey;
  onProgressChange?: () => void;
}) {
  const [activeKey, setActiveKey] = useState<PlanKey>(initialPlanKey ?? "plan3Days");
  const [copied, setCopied] = useState(false);
  const days = plan[activeKey];
  const activeOption = planOptions.find((option) => option.key === activeKey) ?? planOptions[0];
  const storageKey = getLearningPlanStorageKey(projectName, activeKey);
  const markdown = useMemo(() => toMarkdown(projectName, activeOption.days, days), [activeOption.days, days, projectName]);
  const steps = useMemo(() => days.flatMap(getLearningPlanSteps), [days]);
  const { completed, toggleStep: toggleSyncedStep, syncState } = useSyncedProgress({
    planId: `legacy:${projectName}:${activeKey}`,
    storageKey,
    stepIds: steps.map((step) => step.id)
  });
  const completedCount = steps.filter((step) => completed[step.id]).length;
  const totalCount = steps.length;

  useEffect(() => {
    if (initialPlanKey) setActiveKey(initialPlanKey);
  }, [initialPlanKey, projectName]);

  function toggleStep(stepId: string) {
    toggleSyncedStep(stepId);
    window.setTimeout(() => onProgressChange?.(), 0);
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className={compact ? "" : "rounded-lg border border-slate-200 bg-white p-5"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">学习路线</h2>
          <p className="mt-1 text-sm text-slate-600">按步骤推进，每完成一步就点亮前面的圆圈。</p>
        </div>
        <Button variant="secondary" onClick={copyMarkdown}>
          {copied ? <Check size={15} /> : <Clipboard size={15} />}
          {copied ? "已复制" : "复制 Markdown"}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-1">
        {planOptions.map((option) => (
          <button
            key={option.key}
            className={cn(
              "focus-ring h-9 rounded-md text-sm font-medium text-slate-600 transition",
              activeKey === option.key && "bg-white text-teal-700 shadow-sm"
            )}
            onClick={() => setActiveKey(option.key)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 text-xs font-medium text-slate-500">
        已完成 {completedCount}/{totalCount} 个步骤
      </div>
      <div className="mt-1 text-xs text-slate-400">
        {syncState === "synced" ? "已同步到匿名会话" : syncState === "offline" ? "离线保存，联网后同步" : "正在同步进度"}
      </div>

      <div className="mt-4 grid gap-4">
        {days.map((day) => (
          <article key={day.day} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase text-teal-700">Day {day.day}</div>
                <h3 className="mt-1 text-sm font-semibold leading-6 text-slate-950">{day.goal}</h3>
              </div>
              <div className="rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700">D{day.day}</div>
            </div>

            <ol className="mt-4 grid gap-2">
              {getLearningPlanSteps(day).map((step, index) => {
                const isDone = Boolean(completed[step.id]);

                return (
                  <li
                    key={step.id}
                    className={cn(
                      "flex gap-3 rounded-md border px-3 py-2.5 transition",
                      isDone ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50"
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={isDone}
                      onClick={() => toggleStep(step.id)}
                      className={cn(
                        "focus-ring mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
                        isDone ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-transparent"
                      )}
                    >
                      <Check size={13} />
                    </button>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-500">
                        步骤 {index + 1}
                        {step.type === "deliverable" ? " · 交付物" : ""}
                      </div>
                      <div className={cn("mt-0.5 text-sm leading-6", isDone ? "font-medium text-teal-900" : "text-slate-700")}>
                        {step.label}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

function toMarkdown(projectName: string, days: number, planDays: LearningPlanDay[]) {
  const lines = [`# ${projectName} ${days} 天学习路线`, ""];

  for (const day of planDays) {
    lines.push(`## Day ${day.day}: ${day.goal}`);
    for (const task of day.tasks) {
      lines.push(`- [ ] ${task}`);
    }
    lines.push(`- [ ] 交付物：${day.deliverable}`, "");
  }

  return lines.join("\n");
}
