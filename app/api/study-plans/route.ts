import { NextResponse } from "next/server";
import { authorizeAdminRequest, consumeGlobalRateLimit, consumeRequestRateLimit, readBoundedJson } from "@/lib/api-security";
import { isShowcaseMode, showcaseReadOnlyError } from "@/lib/deployment-mode";
import { listShowcaseStudyPlans } from "@/lib/showcase-study-plans";
import {
  getCachedDetailedStudyPlan,
  listDetailedStudyPlans
} from "@/lib/detailed-study-plans";
import { filterDetailedStudyPlansForActiveProfile } from "@/lib/detailed-study-plan-cache";
import { findActiveJobRunForUser, getJobRun } from "@/lib/job-runs";
import { getUserPreference } from "@/lib/preferences";
import { getLearningRecommendation } from "@/lib/radar";
import { resolveAnonymousSession } from "@/lib/session-context";
import {
  cancelDetailedStudyPlanJob,
  detailedStudyPlanJobName,
  enqueueDetailedStudyPlanJob,
  parseStudyPlanJobPayload,
  scheduleLocalDetailedStudyPlanJob
} from "@/lib/study-plan-jobs";
import type { DetailedStudyPlanDuration, JobRun } from "@/lib/types";

export async function GET(request: Request) {
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();

  if (runId) {
    if (runId.length > 180) return NextResponse.json({ status: "error", message: "runId 无效。" }, { status: 400 });
    const job = await getJobRun(runId);
    if (!job || job.jobName !== detailedStudyPlanJobName || job.payload.userId !== session.userId) {
      return NextResponse.json({ status: "error", message: "没有找到这个学习方案任务。" }, { status: 404 });
    }
    const payload = parseStudyPlanJobPayload(job);
    const plan = payload ? await readPlanForPayload(payload) : null;
    return NextResponse.json(
      { status: "success", job: toPublicStudyPlanJob(job), plan },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const owner = url.searchParams.get("owner")?.trim();
  const repo = url.searchParams.get("repo")?.trim();
  if (owner && repo) {
    const preference = await getUserPreference(session.userId);
    const recommendation = await getLearningRecommendation(owner, repo, preference);
    if (!recommendation) {
      return NextResponse.json({ status: "error", message: "候选项目中没有找到这个仓库。" }, { status: 404 });
    }
    const showcasePlans = listShowcaseStudyPlans([recommendation], preference);
    const storedPlans = filterDetailedStudyPlansForActiveProfile(
      await listDetailedStudyPlans(recommendation.repo.id),
      preference
    );
    const seenPlanIds = new Set<string>();
    const plans = [...showcasePlans, ...storedPlans].filter((plan) => {
      const identity = plan.cache?.key ?? plan.id;
      if (seenPlanIds.has(identity)) return false;
      seenPlanIds.add(identity);
      return true;
    });
    const activeJob = await findActiveJobRunForUser(detailedStudyPlanJobName, session.userId);
    return NextResponse.json(
      {
        status: "success",
        plans,
        job: activeJob ? toPublicStudyPlanJob(activeJob) : null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const repoId = Number(url.searchParams.get("repoId"));
  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ status: "error", message: "需要提供 owner/repo、runId 或有效 repoId。" }, { status: 400 });
  }
  const preference = await getUserPreference(session.userId);
  const plans = filterDetailedStudyPlansForActiveProfile(await listDetailedStudyPlans(repoId), preference);
  return NextResponse.json({ status: "success", plans });
}

export async function POST(request: Request) {
  if (isShowcaseMode()) return showcaseReadOnlyResponse();

  const input = await readRequestBody(request);
  if (!input) return NextResponse.json({ status: "error", message: "请求体必须是 JSON 对象。" }, { status: 400 });

  const owner = typeof input.owner === "string" ? input.owner.trim() : "";
  const repo = typeof input.repo === "string" ? input.repo.trim() : "";
  const duration = normalizeDuration(input.duration);
  const force = input.force === true;
  if (!owner || !repo || !duration) {
    return NextResponse.json(
      { status: "error", message: "owner、repo 和 duration（3、7、14）都是必填项。" },
      { status: 400 }
    );
  }

  if (force) {
    const authorization = authorizeAdminRequest(request, { allowDevelopmentBypass: false });
    if (!authorization.authorized) {
      return NextResponse.json(
        {
          status: "error",
          code: "forced_generation_forbidden",
          message: "强制重新生成只允许自部署站点的管理员调用，匿名访客只能复用已有方案。"
        },
        { status: authorization.status }
      );
    }
  }

  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  const preference = await getUserPreference(session.userId);
  const recommendation = await getLearningRecommendation(owner, repo, preference);
  if (!recommendation) {
    return NextResponse.json({ status: "error", message: "候选项目中没有找到这个仓库。" }, { status: 404 });
  }
  const cachedPlan = await getCachedDetailedStudyPlan(recommendation, duration, preference);
  if (!force && cachedPlan?.generationStatus === "complete") {
    return NextResponse.json({
      status: "success",
      queued: false,
      cached: true,
      message: "这个周期的完整方案已经生成，可直接继续学习。",
      plan: cachedPlan,
      job: null
    });
  }

  const perClientLimit = await consumeRequestRateLimit(request, {
    scope: force ? "study-plan-force" : "study-plan-generate",
    limit: force ? 3 : 8,
    windowMs: 60 * 60 * 1000
  });
  if (!perClientLimit.allowed) return rateLimitResponse(perClientLimit.retryAfterSeconds);
  const globalLimit = await consumeGlobalRateLimit("study-plan-generate", 40, 60 * 60 * 1000);
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit.retryAfterSeconds);

  try {
    const { job, created } = await enqueueDetailedStudyPlanJob({
      userId: session.userId,
      owner,
      repo,
      repoFullName: recommendation.repo.fullName,
      duration,
      force,
      preference: { level: preference.level, goal: preference.goal }
    });
    if (job.status === "queued") scheduleLocalDetailedStudyPlanJob(job.runId);
    return NextResponse.json(
      {
        status: "success",
        queued: true,
        created,
        runId: job.runId,
        job: toPublicStudyPlanJob(job),
        plan: cachedPlan,
        message: created
          ? `${duration} 天方案已进入后台队列。`
          : "当前已有学习方案任务正在生成，请等待完成。"
      },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        status: "error",
        message: "无法创建学习方案后台任务。"
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  if (isShowcaseMode()) return showcaseReadOnlyResponse();

  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  const input = await readRequestBody(request);
  const runId = typeof input?.runId === "string" ? input.runId.trim() : "";
  if (!runId || runId.length > 180) {
    return NextResponse.json({ status: "error", message: "runId 无效。" }, { status: 400 });
  }
  const job = await cancelDetailedStudyPlanJob(runId, session.userId);
  if (!job) return NextResponse.json({ status: "error", message: "没有找到这个学习方案任务。" }, { status: 404 });
  return NextResponse.json({
    status: "success",
    message: job.status === "cancelled" ? "任务已停止。" : "任务已经开始一次性生成，不能中途停止。",
    job: toPublicStudyPlanJob(job)
  });
}

function showcaseReadOnlyResponse() {
  return NextResponse.json(showcaseReadOnlyError, {
    status: 403,
    headers: { "Cache-Control": "no-store" }
  });
}

async function readPlanForPayload(payload: NonNullable<ReturnType<typeof parseStudyPlanJobPayload>>) {
  const recommendation = await getLearningRecommendation(payload.owner, payload.repo, payload.preference);
  if (!recommendation) return null;
  return getCachedDetailedStudyPlan(recommendation, payload.duration, payload.preference);
}

function toPublicStudyPlanJob(job: JobRun) {
  const payload = parseStudyPlanJobPayload(job);
  return {
    runId: job.runId,
    jobName: job.jobName,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    summary: job.summary,
    errorSummary: getPublicJobError(job),
    errorCategory: job.errorCategory,
    createdAt: job.createdAt,
    availableAt: job.availableAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    heartbeatAt: job.heartbeatAt,
    updatedAt: job.updatedAt,
    duration: payload?.duration ?? null,
    repoFullName: payload?.repoFullName ?? null
  };
}

function getPublicJobError(job: JobRun) {
  if (!job.errorSummary) return null;
  if (job.status === "cancelled") return "任务已停止。";
  return "学习方案生成失败，请稍后重新生成。";
}

function sessionRequired() {
  return NextResponse.json({ status: "error", message: "需要有效的匿名会话，请刷新页面后重试。" }, { status: 401 });
}

function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      status: "error",
      code: "rate_limited",
      message: "详细学习方案生成过于频繁，请稍后再试。",
      retryAfterSeconds
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

function normalizeDuration(value: unknown): DetailedStudyPlanDuration | null {
  return value === 3 || value === 7 || value === 14 ? value : null;
}

async function readRequestBody(request: Request) {
  const bodyResult = await readBoundedJson(request, { maxBytes: 4_096, label: "Study plan" });
  return bodyResult.ok && isRecord(bodyResult.value) ? bodyResult.value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
