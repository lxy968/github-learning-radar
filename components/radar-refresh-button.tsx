"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JobRunStatus } from "@/lib/types";

type RunSummary = {
  radarRunId: string;
  source: "seed" | "github";
  status: "success" | "partial" | "failed";
  candidateCount: number;
  recommendationCount: number;
  finishedAt: string;
  durationMs: number;
};

type PublicJob = {
  runId: string;
  jobName: string;
  status: JobRunStatus;
  stage: string | null;
  progress: { completed: number; total: number };
  attemptCount: number;
  maxAttempts: number;
  summary: Record<string, unknown>;
  errorSummary: string | null;
  errorCategory: string | null;
  createdAt: string;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string;
};

type RefreshResponse = {
  status: JobRunStatus | "idle" | "skipped" | "error";
  code?: string;
  message?: string;
  reason?: string;
  detail?: string;
  retryAfterSeconds?: number;
  runId?: string;
  job?: PublicJob | null;
  latestRun?: RunSummary | null;
};

type StoredRefresh = {
  startedAt: string;
  runId?: string;
};

const refreshStorageKey = "github-learning-radar:active-refresh";

export function RadarRefreshButton() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "skipped" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const settleResponse = useCallback(
    (data: RefreshResponse) => {
      const job = data.job;
      if (job && (job.status === "queued" || job.status === "running")) {
        writeStoredRefresh({ startedAt: job.createdAt, runId: job.runId });
        setStatus("running");
        setMessage(formatJobMessage(job));
        return;
      }

      if (job && (job.status === "success" || job.status === "partial")) {
        removeStoredRefresh();
        setStatus("done");
        const summary = data.latestRun ?? readRunSummary(job.summary);
        setMessage(summary ? formatRunSummary(summary, data.message) : data.message ?? "雷达刷新已完成。");
        router.refresh();
        window.setTimeout(() => {
          setStatus("idle");
          setMessage(null);
        }, 4000);
        return;
      }

      if (job && (job.status === "failed" || job.status === "cancelled")) {
        removeStoredRefresh();
        setStatus("error");
        setMessage(job.errorSummary ?? (job.status === "cancelled" ? "刷新任务已取消。" : "刷新任务执行失败，请重试。"));
      }
    },
    [router]
  );

  const syncRefreshState = useCallback(async () => {
    const storedRefresh = readStoredRefresh();
    const query = storedRefresh?.runId ? `?runId=${encodeURIComponent(storedRefresh.runId)}` : "";

    try {
      const response = await fetch(`/api/radar/refresh${query}`, {
        method: "GET",
        cache: "no-store"
      });
      const data = await readRefreshResponse(response);

      if (!response.ok) {
        if (storedRefresh) {
          if (response.status === 404) removeStoredRefresh();
          setStatus(response.status === 404 ? "error" : "running");
          setMessage(
            response.status === 404
              ? "之前的刷新任务已不存在，请重新发起。"
              : data.message ?? "刷新任务可能仍在运行，暂时无法读取详细阶段。"
          );
        }
        return;
      }

      if (data.job) {
        settleResponse(data);
        return;
      }

      if (storedRefresh) {
        removeStoredRefresh();
        setStatus("error");
        setMessage("刷新任务已经停止，但没有找到持久化任务记录，请重试。");
      }
    } catch {
      if (storedRefresh) {
        setStatus("running");
        setMessage("刷新状态暂时不可用，正在等待服务恢复……");
      }
    }
  }, [settleResponse]);

  useEffect(() => {
    void syncRefreshState();
  }, [syncRefreshState]);

  useEffect(() => {
    if (status !== "running") return;
    const interval = window.setInterval(() => void syncRefreshState(), 1500);
    return () => window.clearInterval(interval);
  }, [status, syncRefreshState]);

  async function refresh() {
    writeStoredRefresh({ startedAt: new Date().toISOString() });
    setStatus("running");
    setMessage("正在创建刷新任务……");

    try {
      const response = await fetch("/api/radar/refresh", {
        method: "POST",
        cache: "no-store"
      });
      const data = await readRefreshResponse(response);

      if (!response.ok) {
        removeStoredRefresh();
        setStatus("error");
        setMessage(data.message ?? data.detail ?? `刷新失败（HTTP ${response.status}）`);
        return;
      }

      if (data.status === "skipped") {
        removeStoredRefresh();
        setStatus("skipped");
        setMessage(
          data.retryAfterSeconds
            ? `刚刚刷新过，请在 ${data.retryAfterSeconds} 秒后再试。`
            : data.reason ?? "本次刷新已跳过。"
        );
        window.setTimeout(() => {
          setStatus("idle");
          setMessage(null);
        }, 3000);
        return;
      }

      if (data.job) {
        settleResponse(data);
        return;
      }

      removeStoredRefresh();
      setStatus("error");
      setMessage("刷新接口没有返回任务记录，请重试。");
    } catch (error) {
      setStatus("running");
      setMessage(
        error instanceof TypeError
          ? "网络暂时不可用，正在尝试找回刚创建的任务……"
          : error instanceof Error
            ? error.message
            : "刷新状态未知，正在继续查询……"
      );
    }
  }

  return (
    <div className="flex max-w-sm flex-col items-end gap-1.5">
      <Button
        data-testid="radar-refresh-button"
        variant={status === "error" ? "danger" : "primary"}
        onClick={refresh}
        disabled={status === "running"}
      >
        <RefreshCw size={15} className={status === "running" ? "animate-spin" : undefined} />
        {status === "running"
          ? "刷新中"
          : status === "done"
            ? "刷新完成"
            : status === "skipped"
              ? "暂未刷新"
              : status === "error"
                ? "重试刷新"
                : "刷新雷达"}
      </Button>
      {message ? (
        <span
          data-testid="radar-refresh-status"
          aria-live="polite"
          className={status === "error" ? "text-right text-xs text-red-700" : "text-right text-xs text-slate-500"}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}

async function readRefreshResponse(response: Response): Promise<RefreshResponse> {
  try {
    return (await response.json()) as RefreshResponse;
  } catch {
    throw new Error(`刷新接口返回了无法解析的响应（HTTP ${response.status}）。`);
  }
}

function formatJobMessage(job: PublicJob) {
  if (job.status === "queued") {
    const retryDelay = new Date(job.availableAt).getTime() - Date.now();
    return retryDelay > 1_000
      ? `刷新任务将在 ${Math.ceil(retryDelay / 1000)} 秒后重试。`
      : "刷新任务已排队，正在等待执行。";
  }
  const labels: Record<string, string> = {
    "load-preferences": "正在读取兴趣偏好",
    "github-discovery": "正在搜索 GitHub 候选项目",
    "persist-repository-snapshots": "正在保存候选项目和指标快照",
    "rule-scoring": "正在为候选项目计算规则评分",
    "save-recovery-checkpoint": "正在保存可恢复的初步结果",
    "ai-analysis": "AI 正在生成项目分析和学习路线（这一阶段最耗时）",
    "save-final-run": "正在保存最终雷达结果",
    "save-fallback-run": "正在保存可用的 fallback 结果"
  };
  const startedAt = job.startedAt ?? job.createdAt;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const progress = job.progress.total > 0 ? ` · ${job.progress.completed}/${job.progress.total}` : "";
  return `${labels[job.stage ?? ""] ?? "正在执行刷新任务"}${progress} · 已运行 ${elapsedSeconds} 秒`;
}

function formatRunSummary(summary: RunSummary, message?: string) {
  const source = summary.source === "github" ? "GitHub" : "fallback";
  const seconds = Math.max(1, Math.round(summary.durationMs / 1000));
  return `${message ?? "雷达已更新。"} 来源：${source}，${summary.recommendationCount} 个推荐，耗时 ${seconds} 秒。`;
}

function readRunSummary(value: Record<string, unknown>): RunSummary | null {
  if (
    typeof value.radarRunId !== "string" ||
    (value.source !== "github" && value.source !== "seed") ||
    (value.status !== "success" && value.status !== "partial" && value.status !== "failed") ||
    typeof value.candidateCount !== "number" ||
    typeof value.recommendationCount !== "number" ||
    typeof value.finishedAt !== "string" ||
    typeof value.durationMs !== "number"
  ) {
    return null;
  }
  return value as RunSummary;
}

function readStoredRefresh(): StoredRefresh | null {
  try {
    const raw = window.sessionStorage.getItem(refreshStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRefresh>;
    if (typeof parsed.startedAt !== "string") return null;
    return {
      startedAt: parsed.startedAt,
      runId: typeof parsed.runId === "string" ? parsed.runId : undefined
    };
  } catch {
    return null;
  }
}

function writeStoredRefresh(refresh: StoredRefresh) {
  try {
    window.sessionStorage.setItem(refreshStorageKey, JSON.stringify(refresh));
  } catch {
    // The persistent server-side job remains the source of truth when browser storage is unavailable.
  }
}

function removeStoredRefresh() {
  try {
    window.sessionStorage.removeItem(refreshStorageKey);
  } catch {
    // Ignore unavailable browser storage.
  }
}
