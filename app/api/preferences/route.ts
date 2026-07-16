import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRequestRateLimit, readBoundedJson } from "@/lib/api-security";
import { getUserPreference, saveUserPreference } from "@/lib/preferences";
import { resolveAnonymousSession } from "@/lib/session-context";

const preferenceSchema = z.object({
  interests: z.array(z.enum(["ai-app", "frontend", "backend", "devtool", "database", "automation", "cli", "fullstack"])).min(1),
  languages: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  goal: z.enum(["clone", "portfolio", "trend", "source-reading"]),
  refreshInterval: z.enum(["daily", "three-days", "weekly", "monthly", "never"])
});

export async function GET(request: Request) {
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  return NextResponse.json({
    preference: await getUserPreference(session.userId)
  });
}

export async function PUT(request: Request) {
  const rateLimit = await consumeRequestRateLimit(request, {
    scope: "preferences-write",
    limit: 20,
    windowMs: 60 * 1000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many preference updates", retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();

  const bodyResult = await readBoundedJson(request, { maxBytes: 16_384, label: "Preference" });
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
  }
  const parsed = preferenceSchema.safeParse(bodyResult.value);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid preference payload",
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    preference: await saveUserPreference(parsed.data, session.userId)
  });
}

function sessionRequired() {
  return NextResponse.json({ error: "Anonymous session is required. Reload the page and try again." }, { status: 401 });
}
