import { NextResponse } from "next/server";
import { consumeGlobalRateLimit, consumeRequestRateLimit, redactOperationalError } from "@/lib/api-security";
import {
  getCachedDetailedStudyPlan,
  getOrCreateDetailedStudyPlan,
  listDetailedStudyPlans
} from "@/lib/detailed-study-plans";
import { getUserPreference } from "@/lib/preferences";
import { filterDetailedStudyPlansForActiveProfile } from "@/lib/detailed-study-plan-cache";
import { getCurrentRecommendation } from "@/lib/radar";
import { resolveAnonymousSession } from "@/lib/session-context";
import type { DetailedStudyPlanDuration } from "@/lib/types";

export async function GET(request: Request) {
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  const url = new URL(request.url);
  const repoId = Number(url.searchParams.get("repoId"));

  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ status: "error", message: "repoId 必须是正整数。" }, { status: 400 });
  }

  const preference = await getUserPreference(session.userId);
  const plans = filterDetailedStudyPlansForActiveProfile(await listDetailedStudyPlans(repoId), preference);
  return NextResponse.json({ status: "success", plans });
}

export async function POST(request: Request) {
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "请求体必须是 JSON。" }, { status: 400 });
  }

  if (!isRecord(input)) {
    return NextResponse.json({ status: "error", message: "请求参数不完整。" }, { status: 400 });
  }

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

  const recommendation = await getCurrentRecommendation(owner, repo);
  if (!recommendation) {
    return NextResponse.json({ status: "error", message: "当前雷达中没有找到这个项目。" }, { status: 404 });
  }

  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  const preference = await getUserPreference(session.userId);

  if (!force) {
    const cachedPlan = await getCachedDetailedStudyPlan(recommendation, duration, preference);

    if (cachedPlan) {
      return NextResponse.json({
        status: "success",
        cached: true,
        message: "已读取缓存的详细学习方案。",
        plan: cachedPlan
      });
    }
  }

  const perClientLimit = await consumeRequestRateLimit(request, {
    scope: force ? "study-plan-force" : "study-plan-generate",
    limit: force ? 3 : 12,
    windowMs: 60 * 60 * 1000
  });
  if (!perClientLimit.allowed) return rateLimitResponse(perClientLimit.retryAfterSeconds);

  const globalLimit = await consumeGlobalRateLimit("study-plan-generate", 80, 60 * 60 * 1000);
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit.retryAfterSeconds);

  try {
    const result = await getOrCreateDetailedStudyPlan(recommendation, duration, { force, preference });
    return NextResponse.json({
      status: "success",
      cached: result.cached,
      message: result.cached
        ? "已读取缓存的详细学习方案。"
        : result.plan.source === "ai"
          ? "详细学习方案已由 DeepSeek 生成。"
          : "DeepSeek 当前不可用，已生成仓库相关的规则方案。",
      plan: result.plan
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: "详细学习方案生成失败。",
        detail: process.env.NODE_ENV === "development" ? redactOperationalError(error) : undefined
      },
      { status: 500 }
    );
  }
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
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) }
    }
  );
}

function normalizeDuration(value: unknown): DetailedStudyPlanDuration | null {
  return value === 3 || value === 7 || value === 14 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
