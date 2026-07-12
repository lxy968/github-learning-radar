import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRequestRateLimit } from "@/lib/api-security";
import { getUserPreference, saveUserPreference } from "@/lib/preferences";
import { resolveAnonymousSession } from "@/lib/session-context";

const preferenceSchema = z.object({
  interests: z.array(z.enum(["ai-app", "frontend", "backend", "devtool", "database", "automation", "cli", "fullstack"])).min(1),
  languages: z.array(z.string().min(1)).min(1).max(8),
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = preferenceSchema.safeParse(body);

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
