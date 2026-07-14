import { createHash, randomUUID } from "node:crypto";
import { generateDetailedStudyPlan } from "@/lib/ai/detailed-study-plan";
import { redactOperationalError } from "@/lib/api-security";
import {
  getCachedDetailedStudyPlan,
  getOrCreateDetailedStudyPlan
} from "@/lib/detailed-study-plans";
import {
  createOrReuseJobRun,
  findActiveJobRunForUser,
  finishJobRun,
  getJobRun,
  markJobRunRunning,
  requestJobRunCancellation,
  touchJobRunHeartbeat,
  updateJobRunProgress
} from "@/lib/job-runs";
import { classifyOperationalError } from "@/lib/operational-errors";
import { getLearningRecommendation } from "@/lib/radar";
import type {
  DetailedStudyPlan,
  DetailedStudyPlanDuration,
  JobRun,
  RadarRecommendation,
  UserPreference
} from "@/lib/types";

export const detailedStudyPlanJobName = "detailed-study-plan";

type StudyPlanJobPayload = {
  userId: string;
  owner: string;
  repo: string;
  repoFullName: string;
  duration: DetailedStudyPlanDuration;
  force: boolean;
  preference: Pick<UserPreference, "level" | "goal">;
};

type InitialGenerator = NonNullable<Parameters<typeof getOrCreateDetailedStudyPlan>[2]["generate"]>;
export async function enqueueDetailedStudyPlanJob(input: StudyPlanJobPayload) {
  return withEnqueueLock(input.userId, async () => {
    const active = await findActiveJobRunForUser(detailedStudyPlanJobName, input.userId);
    if (active) return { job: active, created: false };

    const idempotencyKey = [
      "study-plan",
      createHash("sha256").update(input.userId).digest("hex").slice(0, 16),
      Date.now(),
      randomUUID().slice(0, 8)
    ].join(":");

    try {
      return await createOrReuseJobRun({
        idempotencyKey,
        jobName: detailedStudyPlanJobName,
        maxAttempts: 1,
        payload: input
      });
    } catch (error) {
      const raced = await findActiveJobRunForUser(detailedStudyPlanJobName, input.userId);
      if (raced) return { job: raced, created: false };
      throw error;
    }
  });
}

export async function executeDetailedStudyPlanJob(
  runId: string,
  options: {
    loadRecommendation?: (owner: string, repo: string) => Promise<RadarRecommendation | undefined>;
    generateInitial?: InitialGenerator;
    heartbeatIntervalMs?: number;
    now?: Date;
    claimedJob?: JobRun;
  } = {}
): Promise<JobRun> {
  const claimed = options.claimedJob ?? await markJobRunRunning(runId, "prepare-study-plan", options.now);
  if (!claimed) {
    const existing = await getJobRun(runId);
    if (!existing) throw new Error(`Study plan job ${runId} was not found.`);
    return existing;
  }
  if (claimed.runId !== runId || claimed.jobName !== detailedStudyPlanJobName || claimed.status !== "running") {
    throw new Error(`Study plan job ${runId} must be queued or already claimed for execution.`);
  }

  const payload = parsePayload(claimed.payload);
  const loadRecommendation =
    options.loadRecommendation ??
    (async (owner, repo) => (await getLearningRecommendation(owner, repo, payload.preference)) ?? undefined);
  const heartbeatIntervalMs = Math.max(1_000, Math.round(options.heartbeatIntervalMs ?? 15_000));
  const heartbeatTimer = setInterval(() => void touchJobRunHeartbeat(runId).catch(() => undefined), heartbeatIntervalMs);
  if (typeof heartbeatTimer === "object" && "unref" in heartbeatTimer) heartbeatTimer.unref();

  try {
    const recommendation = await loadRecommendation(payload.owner, payload.repo);
    if (!recommendation) throw new Error("候选项目中没有找到这个仓库，无法继续生成学习方案。");

    const strictInitial: InitialGenerator =
      options.generateInitial ??
      ((item, duration, context) => generateDetailedStudyPlan(item, duration, context, { allowRuleFallback: false }));
    let plan = payload.force
      ? null
      : await getCachedDetailedStudyPlan(recommendation, payload.duration, payload.preference);

    if (await isCancellationRequested(runId)) return finishCancellation(runId);
    if (!plan || payload.force || generatedThrough(plan) < payload.duration) {
      await updateJobRunProgress(runId, {
        stage: "generating-full-plan",
        completed: 0,
        total: payload.duration
      });
      const initial = await getOrCreateDetailedStudyPlan(recommendation, payload.duration, {
        preference: payload.preference,
        force: true,
        generate: strictInitial
      });
      plan = initial.plan;
      if (generatedThrough(plan) < payload.duration) {
        throw new Error(`模型没有返回完整的 ${payload.duration} 天方案。`);
      }
      await recordSavedProgress(runId, plan);
    }

    const finished = await finishJobRun(runId, {
      status: "success",
      stage: "study-plan-complete",
      summary: createStudyPlanJobSummary(plan)
    });
    if (!finished) throw new Error(`Study plan job ${runId} could not be finalized.`);
    return finished;
  } catch (error) {
    const classified = classifyOperationalError(error, { system: "ai" });
    const recommendation = await loadRecommendation(payload.owner, payload.repo).catch(() => undefined);
    const existingPlan = recommendation
      ? await getCachedDetailedStudyPlan(recommendation, payload.duration, payload.preference).catch(() => null)
      : null;
    const finished = await finishJobRun(runId, {
      status: "failed",
      stage: "study-plan-failed",
      summary: existingPlan ? createStudyPlanJobSummary(existingPlan) : {},
      errorSummary: redactOperationalError(error, 500),
      errorCategory: classified.category
    });
    if (!finished) {
      const existing = await getJobRun(runId);
      if (existing) return existing;
      throw error;
    }
    return finished;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export function scheduleLocalDetailedStudyPlanJob(runId: string) {
  if (process.env.NODE_ENV === "production" || process.env.STUDY_PLAN_DISABLE_LOCAL_JOB_AUTOSTART === "1") {
    return false;
  }
  const executions = getLocalExecutions();
  if (executions.has(runId)) return false;
  const execution = executeDetailedStudyPlanJob(runId)
    .catch(() => undefined)
    .finally(() => executions.delete(runId));
  executions.set(runId, execution);
  return true;
}

export async function cancelDetailedStudyPlanJob(runId: string, userId: string) {
  const job = await getJobRun(runId);
  if (!job || job.jobName !== detailedStudyPlanJobName || job.payload.userId !== userId) return null;
  if (job.status === "running") return job;
  if (job.status !== "queued") return job;
  return requestJobRunCancellation(runId);
}

export function createStudyPlanJobSummary(plan: DetailedStudyPlan) {
  return {
    planId: plan.id,
    repoId: plan.repoId,
    repoFullName: plan.repoFullName,
    duration: plan.duration,
    generatedThroughDay: generatedThrough(plan),
    generationStatus: plan.generationStatus ?? (generatedThrough(plan) >= plan.duration ? "complete" : "partial"),
    source: plan.source,
    generatedAt: plan.generatedAt
  };
}

export function parseStudyPlanJobPayload(job: JobRun) {
  if (job.jobName !== detailedStudyPlanJobName) return null;
  try {
    return parsePayload(job.payload);
  } catch {
    return null;
  }
}

function parsePayload(payload: Record<string, unknown>): StudyPlanJobPayload {
  const duration = payload.duration;
  const preference = isRecord(payload.preference) ? payload.preference : {};
  if (
    typeof payload.userId !== "string" ||
    typeof payload.owner !== "string" ||
    typeof payload.repo !== "string" ||
    typeof payload.repoFullName !== "string" ||
    (duration !== 3 && duration !== 7 && duration !== 14) ||
    (preference.level !== "beginner" && preference.level !== "intermediate" && preference.level !== "advanced") ||
    (preference.goal !== "clone" && preference.goal !== "portfolio" && preference.goal !== "trend" && preference.goal !== "source-reading")
  ) {
    throw new Error("学习方案任务参数无效。");
  }
  return {
    userId: payload.userId,
    owner: payload.owner,
    repo: payload.repo,
    repoFullName: payload.repoFullName,
    duration,
    force: payload.force === true,
    preference: { level: preference.level, goal: preference.goal }
  };
}

function generatedThrough(plan: DetailedStudyPlan) {
  return plan.generatedThroughDay ?? Math.max(0, ...plan.days.map((day) => day.day));
}

async function recordSavedProgress(runId: string, plan: DetailedStudyPlan) {
  await updateJobRunProgress(runId, {
    stage: "full-plan-saved",
    completed: generatedThrough(plan),
    total: plan.duration
  });
}

async function isCancellationRequested(runId: string) {
  const job = await getJobRun(runId);
  return job?.status === "cancelled" || job?.stage === "cancel-requested";
}

async function finishCancellation(runId: string) {
  const job = await getJobRun(runId);
  if (!job) throw new Error(`Study plan job ${runId} disappeared during cancellation.`);
  if (job.status === "cancelled") return job;
  const finished = await finishJobRun(runId, {
    status: "cancelled",
    stage: "study-plan-cancelled",
    summary: job.summary,
    errorSummary: "任务已停止。",
    errorCategory: "user_cancelled"
  });
  return finished ?? job;
}

function getLocalExecutions() {
  const globalState = globalThis as typeof globalThis & {
    __detailedStudyPlanLocalExecutions?: Map<string, Promise<unknown>>;
  };
  globalState.__detailedStudyPlanLocalExecutions ??= new Map();
  return globalState.__detailedStudyPlanLocalExecutions;
}

function withEnqueueLock<T>(userId: string, operation: () => Promise<T>) {
  const locks = getEnqueueLocks();
  const previous = locks.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const lockPromise = current.then(() => undefined, () => undefined);
  locks.set(userId, lockPromise);
  return current.finally(() => {
    if (locks.get(userId) === lockPromise) locks.delete(userId);
  });
}

function getEnqueueLocks() {
  const globalState = globalThis as typeof globalThis & {
    __detailedStudyPlanEnqueueLocks?: Map<string, Promise<void>>;
  };
  globalState.__detailedStudyPlanEnqueueLocks ??= new Map();
  return globalState.__detailedStudyPlanEnqueueLocks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
