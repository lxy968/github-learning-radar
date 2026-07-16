import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const anonymousSessionCookieName = "glr_session";
export const anonymousSessionMaxAgeSeconds = 365 * 24 * 60 * 60;

const tokenPattern = /^v1\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{43})$/;
const allowedClockSkewMs = 5 * 60_000;

export function createAnonymousSessionToken(issuedAt = new Date()) {
  const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1_000).toString(36);
  return `v1.${issuedAtSeconds}.${randomBytes(32).toString("base64url")}`;
}

export function deriveAnonymousUserId(token: string, referenceDate = new Date()) {
  if (!parseAnonymousSessionToken(token, referenceDate)) return null;
  return `anon_${createHash("sha256").update(token).digest("hex")}`;
}

export function getAnonymousSessionFromRequest(request: Request, referenceDate = new Date()) {
  const token = readCookie(request.headers.get("cookie"), anonymousSessionCookieName) ?? "";
  const parsed = parseAnonymousSessionToken(token, referenceDate);
  if (!parsed) return null;
  return {
    token,
    userId: `anon_${createHash("sha256").update(token).digest("hex")}`,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt
  };
}

export async function getCurrentAnonymousUserId() {
  const cookieStore = await cookies();
  const userId = deriveAnonymousUserId(cookieStore.get(anonymousSessionCookieName)?.value ?? "");
  if (!userId) throw new Error("Anonymous session cookie is missing or invalid.");
  return userId;
}

export function isValidAnonymousSessionToken(token: string, referenceDate = new Date()) {
  return Boolean(parseAnonymousSessionToken(token, referenceDate));
}

function parseAnonymousSessionToken(token: string, referenceDate: Date) {
  const match = token.match(tokenPattern);
  if (!match) return null;
  const issuedAtMs = Number.parseInt(match[1], 36) * 1_000;
  if (!Number.isFinite(issuedAtMs)) return null;
  const nowMs = referenceDate.getTime();
  const expiresAtMs = issuedAtMs + anonymousSessionMaxAgeSeconds * 1_000;
  if (issuedAtMs > nowMs + allowedClockSkewMs || expiresAtMs <= nowMs) return null;
  return { issuedAt: new Date(issuedAtMs), expiresAt: new Date(expiresAtMs) };
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
