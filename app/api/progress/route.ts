import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRequestRateLimit, readBoundedJson } from "@/lib/api-security";
import { getLearningProgress, mergeLearningProgress } from "@/lib/learning-progress";
import { resolveAnonymousSession } from "@/lib/session-context";

const planIdSchema = z.string().min(1).max(200);
const updateSchema = z.object({
  planId: planIdSchema,
  updates: z
    .array(
      z.object({
        stepId: z.string().min(1).max(160),
        completed: z.boolean(),
        updatedAt: z.iso.datetime()
      })
    )
    .min(1)
    .max(200)
});

export async function GET(request: Request) {
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  const parsedPlanId = planIdSchema.safeParse(new URL(request.url).searchParams.get("planId"));
  if (!parsedPlanId.success) return NextResponse.json({ error: "Invalid planId" }, { status: 400 });
  return NextResponse.json({
    planId: parsedPlanId.data,
    entries: await getLearningProgress(session.userId, parsedPlanId.data)
  });
}

export async function PUT(request: Request) {
  const rateLimit = await consumeRequestRateLimit(request, {
    scope: "learning-progress-write",
    limit: 180,
    windowMs: 60 * 1_000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many progress updates", retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();

  const bodyResult = await readBoundedJson(request, { maxBytes: 131_072, label: "Progress" });
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
  }
  const parsed = updateSchema.safeParse(bodyResult.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid progress payload", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json({
    planId: parsed.data.planId,
    entries: await mergeLearningProgress(session.userId, parsed.data.planId, parsed.data.updates)
  });
}

function sessionRequired() {
  return NextResponse.json({ error: "Anonymous session is required. Reload the page and try again." }, { status: 401 });
}
