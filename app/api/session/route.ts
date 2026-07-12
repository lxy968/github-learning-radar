import { NextResponse } from "next/server";
import { consumeRequestRateLimit } from "@/lib/api-security";
import { anonymousSessionCookieName } from "@/lib/anonymous-session";
import { resolveAnonymousSession } from "@/lib/session-context";
import { deleteAnonymousUserData } from "@/lib/user-data";

export async function GET(request: Request) {
  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  return NextResponse.json({
    session: {
      kind: "anonymous",
      storage: process.env.DATABASE_URL ? "postgres" : "local-json",
      expiresAt: session.expiresAt.toISOString()
    }
  });
}

export async function DELETE(request: Request) {
  const rateLimit = await consumeRequestRateLimit(request, {
    scope: "anonymous-data-delete",
    limit: 3,
    windowMs: 60 * 60_000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many data deletion requests", retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const session = await resolveAnonymousSession(request);
  if (!session) return sessionRequired();
  await deleteAnonymousUserData(session.userId);
  const response = NextResponse.json({ status: "deleted" });
  response.cookies.delete(anonymousSessionCookieName);
  return response;
}

function sessionRequired() {
  return NextResponse.json(
    { error: "Anonymous session is required. Reload the page and try again." },
    { status: 401 }
  );
}
