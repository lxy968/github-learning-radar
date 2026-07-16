import { createHash, timingSafeEqual } from "node:crypto";
import { getSqlClient } from "@/lib/db/client";

type LocalRateBucket = {
  count: number;
  windowStartedAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

const localRateBuckets = new Map<string, LocalRateBucket>();

export function authorizeAdminRequest(
  request: Request,
  options: { allowDevelopmentBypass?: boolean } = {}
) {
  if (process.env.NODE_ENV !== "production" && options.allowDevelopmentBypass !== false) {
    return { authorized: true as const, status: 200, code: "development-bypass" };
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return { authorized: false as const, status: 503, code: "admin-secret-missing" };
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(provided, secret)) {
    return { authorized: false as const, status: 401, code: "unauthorized" };
  }

  return { authorized: true as const, status: 200, code: "authorized" };
}

export async function consumeRequestRateLimit(
  request: Request,
  options: {
    scope: string;
    limit: number;
    windowMs: number;
  }
) {
  const identity = getRequestIdentity(request);
  const hashedIdentity = createHash("sha256").update(identity).digest("hex").slice(0, 32);
  return consumeRateLimit(`${options.scope}:${hashedIdentity}`, options.limit, options.windowMs);
}

export async function consumeGlobalRateLimit(scope: string, limit: number, windowMs: number) {
  return consumeRateLimit(`${scope}:global`, limit, windowMs);
}

export async function readBoundedJson(
  request: Request,
  options: { maxBytes: number; label?: string }
): Promise<BoundedJsonResult> {
  const label = options.label?.trim() || "Request";
  const maxBytes = Math.max(256, Math.min(1_048_576, Math.trunc(options.maxBytes)));
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (contentType !== "application/json") {
    return { ok: false, status: 415, error: "Content-Type must be application/json" };
  }

  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? 0 : Number(contentLength);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: `${label} payload is too large` };
  }
  if (!request.body) return { ok: false, status: 400, error: "Request body must be JSON" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: `${label} payload is too large` };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: `Unable to read ${label.toLowerCase()} request body` };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid UTF-8 JSON" };
  }
}

export function redactOperationalError(error: unknown, maxLength = 220) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:ghp_|github_pat_|sk-)[A-Za-z0-9_\-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url-redacted]")
    .slice(0, maxLength);
}

async function consumeRateLimit(rateKey: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, Math.round(limit));
  const safeWindowMs = Math.max(1_000, Math.round(windowMs));
  const sql = getSqlClient();
  const now = new Date();
  const resetBefore = new Date(now.getTime() - safeWindowMs);

  if (sql) {
    const rows = await sql`
      INSERT INTO api_rate_limits (
        rate_key,
        window_started_at,
        request_count,
        updated_at
      )
      VALUES (
        ${rateKey},
        ${now.toISOString()},
        1,
        ${now.toISOString()}
      )
      ON CONFLICT (rate_key) DO UPDATE SET
        request_count = CASE
          WHEN api_rate_limits.window_started_at <= ${resetBefore.toISOString()} THEN 1
          ELSE api_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN api_rate_limits.window_started_at <= ${resetBefore.toISOString()} THEN ${now.toISOString()}
          ELSE api_rate_limits.window_started_at
        END,
        updated_at = ${now.toISOString()}
      RETURNING request_count, window_started_at
    `;
    const count = Number(rows[0]?.request_count ?? safeLimit + 1);
    const windowStartedAt = new Date(String(rows[0]?.window_started_at ?? now.toISOString())).getTime();
    return toRateLimitResult(count, safeLimit, windowStartedAt, safeWindowMs, now.getTime());
  }

  const current = localRateBuckets.get(rateKey);
  const nowMs = now.getTime();
  const bucket = !current || current.windowStartedAt <= nowMs - safeWindowMs
    ? { count: 1, windowStartedAt: nowMs }
    : { ...current, count: current.count + 1 };
  localRateBuckets.set(rateKey, bucket);
  cleanLocalBuckets(nowMs, safeWindowMs);
  return toRateLimitResult(bucket.count, safeLimit, bucket.windowStartedAt, safeWindowMs, nowMs);
}

function toRateLimitResult(
  count: number,
  limit: number,
  windowStartedAt: number,
  windowMs: number,
  nowMs: number
): RateLimitResult {
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + windowMs - nowMs) / 1000))
  };
}

function getRequestIdentity(request: Request) {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return vercelForwarded || forwarded || realIp || "local-or-unknown";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cleanLocalBuckets(nowMs: number, windowMs: number) {
  if (localRateBuckets.size < 500) return;
  for (const [key, bucket] of localRateBuckets) {
    if (bucket.windowStartedAt <= nowMs - windowMs * 2) localRateBuckets.delete(key);
  }
}

export function inspectLocalRateLimitRetention(referenceTime: number, maxAgeMs: number, apply = false) {
  const cutoff = referenceTime - Math.max(1_000, maxAgeMs);
  const expiredKeys = [...localRateBuckets.entries()]
    .filter(([, bucket]) => bucket.windowStartedAt < cutoff)
    .map(([key]) => key);
  if (apply) {
    for (const key of expiredKeys) localRateBuckets.delete(key);
  }
  return expiredKeys.length;
}
