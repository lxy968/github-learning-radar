import { NextResponse } from "next/server";
import { authorizeAdminRequest, redactOperationalError } from "@/lib/api-security";
import { getJobRun, listJobRuns } from "@/lib/job-runs";
import {
  dailyRadarJobName,
  enqueueDailyRadarJob,
  scheduleLocalRadarJob
} from "@/lib/radar-jobs";
import { getLatestRadarRun } from "@/lib/radar-runs";
import { shouldRequireGithubTokenAtWebEdge } from "@/lib/refresh-policy";
import type { JobRun, RadarRun } from "@/lib/types";

const manualRefreshCooldownMs = 5 * 60 * 1000;

export async function GET(request = new Request("http://localhost/api/radar/refresh")) {
  try {
    const runId = new URL(request.url).searchParams.get("runId")?.trim();
    let job: JobRun | null = null;

    if (runId) {
      if (runId.length > 180) {
        return NextResponse.json({ status: "error", message: "runId 无效。" }, { status: 400 });
      }
      job = await getJobRun(runId);
      if (!job || job.jobName !== dailyRadarJobName) {
        return NextResponse.json({ status: "error", message: "没有找到这个雷达刷新任务。" }, { status: 404 });
      }
    } else {
      const recentJobs = await listJobRuns({ limit: 20 });
      job = recentJobs.find(
        (item) => item.jobName === dailyRadarJobName && (item.status === "queued" || item.status === "running")
      ) ?? null;
    }

    if (job) {
      return NextResponse.json(
        {
          status: job.status,
          job: toPublicJob(job),
          latestRun: isTerminal(job) ? job.summary : null
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const latestRun = await getLatestRadarRun();
    return NextResponse.json(
      {
        status: "idle",
        job: null,
        latestRun: latestRun ? getRunSummary(latestRun) : null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        code: "radar_store_unavailable",
        message: "无法读取雷达刷新状态。",
        detail: summarizeError(error)
      },
      { status: 500 }
    );
  }
}

export async function POST(request = new Request("http://localhost/api/radar/refresh", { method: "POST" })) {
  const authorization = authorizeAdminRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json(
      {
        status: "error",
        code: authorization.code,
        message:
          authorization.status === 503
            ? "生产环境尚未配置 ADMIN_SECRET。"
            : "只有管理员可以手动刷新全站雷达。"
      },
      { status: authorization.status }
    );
  }

  if (shouldRequireGithubTokenAtWebEdge(process.env) && !process.env.GITHUB_TOKEN) {
    return NextResponse.json(
      {
        status: "error",
        code: "github_token_missing",
        message: "GitHub Token 未加载。请确认 .env.local 后重启开发服务。"
      },
      { status: 503 }
    );
  }

  let latestRun: RadarRun | null;
  try {
    latestRun = await getLatestRadarRun();
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        code: "radar_store_unavailable",
        message: "无法读取现有雷达记录，请检查本地数据文件或数据库连接。",
        detail: summarizeError(error)
      },
      { status: 500 }
    );
  }

  const cooldown = getManualRefreshCooldown(latestRun);
  if (cooldown.active) {
    return NextResponse.json({
      status: "skipped",
      reason: cooldown.reason,
      retryAfterSeconds: cooldown.retryAfterSeconds,
      latestRun: latestRun ? getRunSummary(latestRun) : null
    });
  }

  try {
    const { job, created } = await enqueueDailyRadarJob({ trigger: "manual" });
    if (job.status === "queued") scheduleLocalRadarJob(job.runId);

    return NextResponse.json(
      {
        status: job.status,
        code: created ? "refresh_queued" : "refresh_reused",
        created,
        reused: !created,
        runId: job.runId,
        statusUrl: `/api/jobs/${encodeURIComponent(job.runId)}`,
        job: toPublicJob(job),
        latestRun: isTerminal(job) ? job.summary : null,
        message: created ? "刷新任务已进入队列。" : "已复用今天已有的刷新任务。"
      },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        code: "refresh_enqueue_failed",
        message: "无法创建雷达刷新任务。",
        detail: summarizeError(error)
      },
      { status: 500 }
    );
  }
}

function getManualRefreshCooldown(latestRun: Awaited<ReturnType<typeof getLatestRadarRun>>) {
  if (process.env.NODE_ENV === "development" || !latestRun) {
    return { active: false, reason: null, retryAfterSeconds: 0 };
  }
  if (latestRun.status !== "success" && latestRun.status !== "partial") {
    return { active: false, reason: null, retryAfterSeconds: 0 };
  }

  const elapsedMs = Date.now() - new Date(latestRun.finishedAt).getTime();
  if (elapsedMs >= manualRefreshCooldownMs) {
    return { active: false, reason: null, retryAfterSeconds: 0 };
  }
  return {
    active: true,
    reason: "Manual refresh cooldown is active.",
    retryAfterSeconds: Math.ceil((manualRefreshCooldownMs - elapsedMs) / 1000)
  };
}

function getRunSummary(run: RadarRun) {
  return {
    radarRunId: run.runId,
    source: run.source,
    status: run.status,
    candidateCount: run.rawCandidateCount,
    recommendationCount: run.recommendationCount,
    finishedAt: run.finishedAt,
    durationMs: Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()),
    metrics: run.metrics ?? null
  };
}

function toPublicJob(job: JobRun) {
  const { payload: _payload, idempotencyKey: _idempotencyKey, ...publicJob } = job;
  return publicJob;
}

function isTerminal(job: JobRun) {
  return job.status === "success" || job.status === "partial" || job.status === "failed" || job.status === "cancelled";
}

function summarizeError(error: unknown) {
  return redactOperationalError(error, 240);
}
