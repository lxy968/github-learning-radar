import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const anonymousSessionCookieName = "glr_session";
export const anonymousSessionMaxAgeSeconds = 365 * 24 * 60 * 60;

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createAnonymousSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function deriveAnonymousUserId(token: string) {
  if (!isValidAnonymousSessionToken(token)) return null;
  return `anon_${createHash("sha256").update(token).digest("hex")}`;
}

export function getAnonymousUserIdFromRequest(request: Request) {
  return deriveAnonymousUserId(readCookie(request.headers.get("cookie"), anonymousSessionCookieName) ?? "");
}

export async function getCurrentAnonymousUserId() {
  const cookieStore = await cookies();
  const userId = deriveAnonymousUserId(cookieStore.get(anonymousSessionCookieName)?.value ?? "");
  if (!userId) throw new Error("Anonymous session cookie is missing or invalid.");
  return userId;
}

export function getAnonymousSessionExpiresAt(referenceDate = new Date()) {
  return new Date(referenceDate.getTime() + anonymousSessionMaxAgeSeconds * 1_000);
}

export function isValidAnonymousSessionToken(token: string) {
  return tokenPattern.test(token);
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}
