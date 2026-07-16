import { NextRequest, NextResponse } from "next/server";
import {
  anonymousSessionCookieName,
  anonymousSessionMaxAgeSeconds,
  createAnonymousSessionToken,
  deriveAnonymousUserId,
  isValidAnonymousSessionToken
} from "@/lib/anonymous-session";
import { registerAnonymousSession } from "@/lib/anonymous-session-store";

export async function proxy(request: NextRequest) {
  const existingToken = request.cookies.get(anonymousSessionCookieName)?.value;
  if (existingToken && isValidAnonymousSessionToken(existingToken)) return NextResponse.next();

  const issuedAt = new Date();
  const token = createAnonymousSessionToken(issuedAt);
  const userId = deriveAnonymousUserId(token, issuedAt);
  if (!userId) throw new Error("Failed to create an anonymous session identity.");
  const registered = await registerAnonymousSession(
    userId,
    new Date(issuedAt.getTime() + anonymousSessionMaxAgeSeconds * 1_000),
    issuedAt
  );
  if (!registered) throw new Error("Failed to register an anonymous session identity.");
  const requestHeaders = new Headers(request.headers);
  const existingCookie = requestHeaders.get("cookie");
  requestHeaders.set(
    "cookie",
    `${existingCookie ? `${existingCookie}; ` : ""}${anonymousSessionCookieName}=${encodeURIComponent(token)}`
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(anonymousSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: anonymousSessionMaxAgeSeconds
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health).*)"]
};
