import { redactOperationalError } from "@/lib/api-security";

export type OperationalSystem = "github" | "ai" | "database" | "worker" | "application";

export type OperationalErrorInfo = {
  system: OperationalSystem;
  category: string;
  retryable: boolean;
  statusCode: number | null;
  retryAfterMs: number | null;
  summary: string;
};

export function classifyOperationalError(
  error: unknown,
  context: { system?: OperationalSystem } = {}
): OperationalErrorInfo {
  const record = toRecord(error);
  const response = toRecord(record.response);
  const statusCode = readNumber(record.statusCode ?? record.status ?? response.status);
  const code = String(record.code ?? toRecord(record.cause).code ?? "").toUpperCase();
  const summary = redactOperationalError(typeof record.message === "string" ? record.message : error, 300);
  const message = summary.toLowerCase();
  const system = context.system ?? inferSystem(message, code);
  const retryAfterMs = readRetryAfterMs(record, response);

  if (isTimeout(error, code, message)) {
    return { system, category: `${system}_timeout`, retryable: true, statusCode, retryAfterMs, summary };
  }
  if (system === "ai" && /insufficient.quota|balance|billing|credit|余额|额度不足/.test(message)) {
    return { system, category: "ai_quota", retryable: false, statusCode, retryAfterMs, summary };
  }
  if (statusCode === 401 || statusCode === 403 || /bad credentials|invalid api key|unauthorized/.test(message)) {
    return { system, category: `${system}_auth`, retryable: false, statusCode, retryAfterMs, summary };
  }
  if (statusCode === 429 || /rate.?limit|too many requests/.test(message)) {
    return { system, category: `${system}_rate_limit`, retryable: true, statusCode, retryAfterMs, summary };
  }
  if (statusCode !== null && statusCode >= 500) {
    return { system, category: `${system}_server`, retryable: true, statusCode, retryAfterMs, summary };
  }
  if (["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return { system, category: `${system}_network`, retryable: true, statusCode, retryAfterMs, summary };
  }
  if (system === "database" || /^P?0[1-9]/.test(code) || /postgres|database|sql/.test(message)) {
    const retryable = !/constraint|duplicate key|syntax|permission|authentication/.test(message);
    return { system: "database", category: retryable ? "database_unavailable" : "database_invalid", retryable, statusCode, retryAfterMs, summary };
  }
  if (/validation|invalid json|schema|parse/.test(message)) {
    return { system, category: `${system}_invalid_response`, retryable: false, statusCode, retryAfterMs, summary };
  }

  const explicitRetryable = typeof record.isRetryable === "boolean" ? record.isRetryable : false;
  return {
    system,
    category: `${system}_unexpected`,
    retryable: explicitRetryable,
    statusCode,
    retryAfterMs,
    summary
  };
}

export function getRetryDelayMs(attemptCount: number, info: OperationalErrorInfo, baseDelayMs = 5_000) {
  if (info.retryAfterMs !== null) return Math.max(baseDelayMs, Math.min(15 * 60_000, info.retryAfterMs));
  return Math.min(5 * 60_000, Math.max(1_000, baseDelayMs) * 2 ** Math.max(0, attemptCount - 1));
}

export async function withOperationalRetry<T>(
  operation: () => Promise<T>,
  options: {
    system: OperationalSystem;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  }
) {
  const maxAttempts = Math.max(1, Math.min(5, Math.round(options.maxAttempts ?? 2)));
  const maxDelayMs = Math.max(0, options.maxDelayMs ?? 5_000);
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const classified = classifyOperationalError(error, { system: options.system });
      if (!classified.retryable || attempt >= maxAttempts) throw error;
      const delay = Math.min(maxDelayMs, getRetryDelayMs(attempt, classified, options.baseDelayMs ?? 500));
      if (delay > 0) await sleep(delay);
    }
  }
}

function inferSystem(message: string, code: string): OperationalSystem {
  if (/github|octokit/.test(message)) return "github";
  if (/deepseek|model|token|ai_/.test(message)) return "ai";
  if (/postgres|database|sql/.test(message) || /^P?0[1-9]/.test(code)) return "database";
  return "application";
}

function isTimeout(error: unknown, code: string, message: string) {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    ["ETIMEDOUT", "ABORT_ERR", "UND_ERR_HEADERS_TIMEOUT"].includes(code) ||
    /timed? ?out|timeout|aborted/.test(message)
  );
}

function readRetryAfterMs(record: Record<string, unknown>, response: Record<string, unknown>) {
  const headers = toRecord(record.responseHeaders ?? response.headers);
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (raw === undefined) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = new Date(String(raw)).getTime();
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
