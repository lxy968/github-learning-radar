import { NextRequest, NextResponse } from "next/server";
import {
  anonymousSessionCookieName,
  anonymousSessionMaxAgeSeconds,
  createAnonymousSessionToken,
  isValidAnonymousSessionToken
} from "@/lib/anonymous-session";

export function proxy(request: NextRequest) {
  const existingToken = request.cookies.get(anonymousSessionCookieName)?.value;
  if (existingToken && isValidAnonymousSessionToken(existingToken)) return NextResponse.next();

  const token = createAnonymousSessionToken();
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};
