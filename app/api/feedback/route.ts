import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRequestRateLimit, readBoundedJson } from "@/lib/api-security";
import { getInteraction, listFeedbackEvents, recordFeedback } from "@/lib/user-state";
import { resolveAnonymousSession } from "@/lib/session-context";
import type { FeedbackEvent } from "@/lib/types";

const feedbackSchema = z.object({
  repoId: z.number().int().positive(),
  eventType: z.enum(["want_to_learn", "bookmarked", "skipped", "too_hard", "too_easy"]),
  value: z.boolean()
}).strict();

const maxFeedbackBodyBytes = 2_048;

export async function GET(request: Request) {
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  const { searchParams } = new URL(request.url);
  const repoId = searchParams.get("repoId");

  if (repoId) {
    const parsedRepoId = Number(repoId);

    if (!Number.isInteger(parsedRepoId) || parsedRepoId <= 0) {
      return NextResponse.json({ error: "Invalid repoId" }, { status: 400 });
    }

    return NextResponse.json({
      interaction: await getInteraction(session.userId, parsedRepoId)
    });
  }

  return NextResponse.json({
    events: (await listFeedbackEvents(session.userId)).map(toPublicEvent)
  });
}

export async function POST(request: Request) {
  const rateLimit = await consumeRequestRateLimit(request, {
    scope: "feedback-write",
    limit: 120,
    windowMs: 60 * 1000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many feedback updates", retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();

  const bodyResult = await readBoundedJson(request, { maxBytes: maxFeedbackBodyBytes, label: "Feedback" });
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
  }
  const body = bodyResult.value;
  const parsed = feedbackSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid feedback payload",
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }

  const result = await recordFeedback(session.userId, parsed.data);

  return NextResponse.json(
    { interaction: result.interaction, event: toPublicEvent(result.event) },
    { status: 201 }
  );
}

function toPublicEvent(event: FeedbackEvent) {
  return {
    id: event.id,
    repoId: event.repoId,
    eventType: event.eventType,
    value: event.value,
    createdAt: event.createdAt
  };
}

function sessionRequired() {
  return NextResponse.json({ error: "Anonymous session is required. Reload the page and try again." }, { status: 401 });
}
