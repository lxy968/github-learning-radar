import {
  getAnonymousSessionExpiresAt,
  getAnonymousUserIdFromRequest
} from "@/lib/anonymous-session";
import { touchAnonymousSession } from "@/lib/anonymous-session-store";

export async function resolveAnonymousSession(request: Request) {
  const userId = getAnonymousUserIdFromRequest(request);
  if (!userId) return null;
  const expiresAt = getAnonymousSessionExpiresAt();
  await touchAnonymousSession(userId, expiresAt);
  return { userId, expiresAt };
}
