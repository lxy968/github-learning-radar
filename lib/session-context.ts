import {
  getAnonymousSessionFromRequest
} from "@/lib/anonymous-session";
import { touchAnonymousSession } from "@/lib/anonymous-session-store";
import { cleanupExpiredAnonymousUserData } from "@/lib/user-data";

const cleanupIntervalMs = 5 * 60_000;
const cleanupRetryMs = 60_000;
let nextCleanupAt = 0;
let cleanupInFlight: Promise<void> | null = null;

export async function resolveAnonymousSession(request: Request) {
  const now = new Date();
  const session = getAnonymousSessionFromRequest(request, now);
  if (!session) return null;
  const touched = await touchAnonymousSession(session.userId, session.expiresAt, now);
  if (!touched) return null;
  await cleanupExpiredSessionsIfDue(now);
  return { userId: session.userId, expiresAt: session.expiresAt };
}

async function cleanupExpiredSessionsIfDue(now: Date) {
  if (now.getTime() < nextCleanupAt) return;
  if (cleanupInFlight) return cleanupInFlight;

  nextCleanupAt = now.getTime() + cleanupIntervalMs;
  cleanupInFlight = cleanupExpiredAnonymousUserData(now)
    .then(() => undefined)
    .catch(() => {
      nextCleanupAt = Date.now() + cleanupRetryMs;
      console.warn("Anonymous session cleanup failed; it will be retried without exposing request data.");
    })
    .finally(() => {
      cleanupInFlight = null;
    });
  return cleanupInFlight;
}
