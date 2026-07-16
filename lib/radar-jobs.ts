import { redactOperationalError } from "@/lib/api-security";
import { assertBackgroundJobsEnabled } from "@/lib/deployment-mode";
import { runDailyRadar, type DailyRadarRunOptions } from "@/lib/daily-radar";
import {
  createDailyRadarIdempotencyKey,
  createOrReuseJobRun,
  finishJobRun,
  getJobRun,
  markJobRunRunning,
  requeueJobRun,
  touchJobRunHeartbeat,
  updateJobRunProgress
} from "@/lib/job-runs";
import type { JobRun, RadarRun } from "@/lib/types";
import { classifyOperationalError, getRetryDelayMs } from "@/lib/operational-errors";

export const dailyRadarJobName = "daily-radar";

type DailyRadarRunner = (options?: DailyRadarRunOptions) => Promise<RadarRun>;

export async function enqueueDailyRadarJob(input: {
  trigger: "manual" | "cron";
  force?: boolean;
  now?: Date;
}) {
  assertBackgroundJobsEnabled("daily radar job creation");
  const now = input.now ?? new Date();
  return createOrReuseJobRun(
    {
      idempotencyKey: createDailyRadarIdempotencyKey(now),
      jobName: dailyRadarJobName,
      maxAttempts: 3,
      payload: {
        trigger: input.trigger,
        force: Boolean(input.force)
      }
    },
    now
  );
}

export async function executeDailyRadarJob(
  runId: string,
  options: { runner?: DailyRadarRunner; heartbeatIntervalMs?: number; now?: Date } = {}
): Promise<JobRun> {
  assertBackgroundJobsEnabled("daily radar job execution");
  const claimed = await markJobRunRunning(runId, "load-preferences", options.now);
  if (!claimed) {
    const existing = await getJobRun(runId);
    if (!existing) throw new Error(`Radar job ${runId} does not exist.`);
    return existing;
  }

  return executeClaimedDailyRadarJob(claimed, options);
}

export async function executeClaimedDailyRadarJob(
  claimed: JobRun,
  options: { runner?: DailyRadarRunner; heartbeatIntervalMs?: number; now?: Date } = {}
): Promise<JobRun> {
  assertBackgroundJobsEnabled("daily radar job execution");
  if (claimed.jobName !== dailyRadarJobName || claimed.status !== "running") {
    throw new Error(`Radar job ${claimed.runId} must be claimed before execution.`);
  }

  const runner = options.runner ?? runDailyRadar;
  const heartbeatIntervalMs = Math.max(10, Math.round(options.heartbeatIntervalMs ?? 15_000));
  const heartbeatTimer = setInterval(() => {
    void touchJobRunHeartbeat(claimed.runId).catch(() => undefined);
  }, heartbeatIntervalMs);
  if (typeof heartbeatTimer === "object" && "unref" in heartbeatTimer) heartbeatTimer.unref();

  try {
    const radarRun = await runner({
      runId: claimed.runId,
      startedAt: new Date(claimed.createdAt),
      onStage: async (stage, progress) => {
        await updateJobRunProgress(claimed.runId, {
          stage,
          completed: progress?.completed ?? 0,
          total: progress?.total ?? 0
        });
      }
    });
    const finished = await finishJobRun(claimed.runId, {
      status: radarRun.status === "success" ? "success" : "partial",
      stage: "save-final-run",
      summary: createRadarRunSummary(radarRun)
    });
    if (!finished) throw new Error(`Radar job ${claimed.runId} could not be finalized.`);
    return finished;
  } catch (error) {
    const classified = classifyOperationalError(error);
    if (classified.retryable && claimed.attemptCount < claimed.maxAttempts) {
      const requeued = await requeueJobRun(claimed.runId, {
        delayMs: getRetryDelayMs(claimed.attemptCount, classified),
        errorSummary: classified.summary,
        errorCategory: classified.category
      }, options.now);
      if (requeued) return requeued;
    }
    const failed = await finishJobRun(claimed.runId, {
      status: "failed",
      errorSummary: redactOperationalError(error, 500),
      errorCategory: classified.category
    });
    if (!failed) throw error;
    return failed;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export function scheduleLocalRadarJob(runId: string) {
  assertBackgroundJobsEnabled("local daily radar job execution");
  if (process.env.NODE_ENV === "production" || process.env.RADAR_DISABLE_LOCAL_JOB_AUTOSTART === "1") {
    return false;
  }

  const executions = getLocalExecutions();
  if (executions.has(runId)) return false;

  const execution = executeDailyRadarJob(runId)
    .catch(() => undefined)
    .finally(() => executions.delete(runId));
  executions.set(runId, execution);
  return true;
}

export function createRadarRunSummary(run: RadarRun) {
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

function getLocalExecutions() {
  const globalState = globalThis as typeof globalThis & {
    __dailyRadarLocalExecutions?: Map<string, Promise<unknown>>;
  };
  globalState.__dailyRadarLocalExecutions ??= new Map();
  return globalState.__dailyRadarLocalExecutions;
}
