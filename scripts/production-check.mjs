import path from "node:path";
import { fileURLToPath } from "node:url";

const profiles = new Set(["web", "worker", "migration"]);
const numericRules = [
  ["GITHUB_SEARCH_PER_PAGE", 5, 100],
  ["GITHUB_DISCOVERY_WINDOW_DAYS", 7, 730],
  ["GITHUB_ENRICH_LIMIT", 0, 80],
  ["GITHUB_ENRICH_CONCURRENCY", 1, 8],
  ["GITHUB_REQUEST_TIMEOUT_MS", 3_000, 60_000],
  ["RADAR_RECOMMENDATION_LIMIT", 1, 24],
  ["RADAR_MAX_ANALYZED_CANDIDATES", 0, 24],
  ["RADAR_AI_CONCURRENCY", 1, 6],
  ["RADAR_AI_TIMEOUT_MS", 5_000, 120_000],
  ["RADAR_WORKER_POLL_MS", 1_000, 60_000],
  ["RADAR_JOB_STALE_AFTER_MS", 30_000, 3_600_000],
  ["STUDY_PLAN_AI_TIMEOUT_MS", 5_000, 120_000],
  ["RETENTION_RADAR_RUN_DAYS", 7, 3_650],
  ["RETENTION_MIN_RADAR_RUNS", 1, 500],
  ["RETENTION_JOB_RUN_DAYS", 1, 3_650],
  ["RETENTION_DETAILED_PLAN_DAYS", 30, 3_650],
  ["RETENTION_REPOSITORY_SNAPSHOT_DAYS", 14, 3_650],
  ["RETENTION_STALE_CANDIDATE_DAYS", 30, 3_650],
  ["RETENTION_RATE_LIMIT_DAYS", 1, 90]
];

export function validateProductionConfig(env, profile) {
  const issues = [];
  const warnings = [];
  const issue = (code, variable, message) => issues.push({ code, variable, message });
  const warn = (code, variable, message) => warnings.push({ code, variable, message });

  if (!profiles.has(profile)) {
    issue("invalid_profile", "profile", "Profile must be web, worker, or migration.");
    return { profile, ok: false, issues, warnings };
  }
  if (env.NODE_ENV !== "production") {
    issue("node_env", "NODE_ENV", "NODE_ENV must be production for a production preflight.");
  }

  validateDatabaseUrl(env.DATABASE_URL, issue, warn);

  if (profile === "web") {
    validateSiteUrl(env, issue);
    validateSecret(env.CRON_SECRET, "CRON_SECRET", issue);
    validateSecret(env.ADMIN_SECRET, "ADMIN_SECRET", issue);
    if (env.CRON_SECRET && env.ADMIN_SECRET && env.CRON_SECRET === env.ADMIN_SECRET) {
      issue("shared_secret", "ADMIN_SECRET", "ADMIN_SECRET and CRON_SECRET must be different values.");
    }
    if (env.GITHUB_TOKEN) {
      warn("unnecessary_secret", "GITHUB_TOKEN", "The Web process does not need GITHUB_TOKEN; keep it on the Worker only.");
    }
  }

  if (profile === "worker") {
    validateGithubToken(env.GITHUB_TOKEN, issue);
    for (const variable of ["ADMIN_SECRET", "CRON_SECRET", "SITE_URL"]) {
      if (env[variable]) warn("unnecessary_secret", variable, `The Worker process does not need ${variable}.`);
    }
  }

  if (profile === "migration") {
    for (const variable of ["GITHUB_TOKEN", "DEEPSEEK_API_KEY", "ADMIN_SECRET", "CRON_SECRET"]) {
      if (env[variable]) warn("unnecessary_secret", variable, `The migration process does not need ${variable}.`);
    }
  } else {
    validateDeepSeek(env, issue, warn);
    validateNumericSettings(env, issue, warn);
  }

  return { profile, ok: issues.length === 0, issues, warnings };
}

function validateDatabaseUrl(value, issue, warn) {
  if (!value) {
    issue("required", "DATABASE_URL", "DATABASE_URL is required.");
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      issue("protocol", "DATABASE_URL", "DATABASE_URL must use postgres:// or postgresql://.");
    }
    if (!url.hostname || !url.username || url.pathname.length < 2) {
      issue("structure", "DATABASE_URL", "DATABASE_URL must include host, username, and database name.");
    }
    if (!url.password) warn("passwordless_database", "DATABASE_URL", "Confirm that passwordless database authentication is intentional.");
  } catch {
    issue("invalid_url", "DATABASE_URL", "DATABASE_URL is not a valid URL.");
  }
}

function validateSiteUrl(env, issue) {
  if (env.NEXT_PUBLIC_SITE_URL && !env.SITE_URL) {
    issue("legacy_site_url", "SITE_URL", "Rename NEXT_PUBLIC_SITE_URL to runtime SITE_URL.");
    return;
  }
  if (!env.SITE_URL) {
    issue("required", "SITE_URL", "SITE_URL is required for canonical metadata, sitemap, and robots.");
    return;
  }
  try {
    const url = new URL(env.SITE_URL);
    if (url.protocol !== "https:") issue("https_required", "SITE_URL", "SITE_URL must use HTTPS in production.");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      issue("origin_only", "SITE_URL", "SITE_URL must be an origin without credentials, path, query, or hash.");
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      issue("public_host", "SITE_URL", "SITE_URL must use the public production hostname.");
    }
  } catch {
    issue("invalid_url", "SITE_URL", "SITE_URL is not a valid URL.");
  }
}

function validateSecret(value, variable, issue) {
  if (!value) {
    issue("required", variable, `${variable} is required.`);
    return;
  }
  if (value.length < 32) issue("weak_secret", variable, `${variable} must contain at least 32 characters.`);
  if (/^(?:change-?me|replace-?me|example|password|secret|test|your[-_])/i.test(value)) {
    issue("placeholder", variable, `${variable} still looks like a placeholder.`);
  }
}

function validateGithubToken(value, issue) {
  if (!value) {
    issue("required", "GITHUB_TOKEN", "GITHUB_TOKEN is required by the Worker.");
    return;
  }
  if (value.length < 20 || /^(?:change-?me|replace-?me|example|test|your[-_])/i.test(value)) {
    issue("invalid_token", "GITHUB_TOKEN", "GITHUB_TOKEN is too short or still looks like a placeholder.");
  }
}

function validateDeepSeek(env, issue, warn) {
  if (!env.DEEPSEEK_API_KEY) {
    warn("deepseek_disabled", "DEEPSEEK_API_KEY", "DeepSeek is disabled; the application will use rule fallback.");
    return;
  }
  const baseUrl = env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") issue("https_required", "DEEPSEEK_BASE_URL", "DEEPSEEK_BASE_URL must use HTTPS.");
  } catch {
    issue("invalid_url", "DEEPSEEK_BASE_URL", "DEEPSEEK_BASE_URL is not a valid URL.");
  }
  if (env.DEEPSEEK_MODEL !== undefined && !env.DEEPSEEK_MODEL.trim()) {
    issue("empty_model", "DEEPSEEK_MODEL", "DEEPSEEK_MODEL must not be empty when explicitly configured.");
  }
}

function validateNumericSettings(env, issue, warn) {
  const parsed = new Map();
  for (const [variable, min, max] of numericRules) {
    if (env[variable] === undefined || env[variable] === "") continue;
    const value = Number(env[variable]);
    if (!Number.isInteger(value) || value < min || value > max) {
      issue("numeric_range", variable, `${variable} must be an integer between ${min} and ${max}.`);
      continue;
    }
    parsed.set(variable, value);
  }
  const pollMs = parsed.get("RADAR_WORKER_POLL_MS") ?? 5_000;
  const staleMs = parsed.get("RADAR_JOB_STALE_AFTER_MS") ?? 300_000;
  if (staleMs < pollMs * 3) {
    warn("tight_stale_window", "RADAR_JOB_STALE_AFTER_MS", "Use at least three Worker polling intervals before declaring a job stale.");
  }
  const recommendationLimit = parsed.get("RADAR_RECOMMENDATION_LIMIT") ?? 6;
  const analyzedLimit = parsed.get("RADAR_MAX_ANALYZED_CANDIDATES") ?? 3;
  if (analyzedLimit > recommendationLimit) {
    warn("excess_ai_limit", "RADAR_MAX_ANALYZED_CANDIDATES", "The AI candidate limit is higher than the final recommendation limit.");
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const profileArgument = process.argv.find((value) => value.startsWith("--profile="));
  const profileIndex = process.argv.indexOf("--profile");
  const profile = profileArgument?.slice("--profile=".length) || (profileIndex >= 0 ? process.argv[profileIndex + 1] : "web");
  const result = validateProductionConfig(process.env, profile);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const warning of result.warnings) console.warn(`WARN ${warning.code} ${warning.variable}: ${warning.message}`);
    for (const issue of result.issues) console.error(`ERROR ${issue.code} ${issue.variable}: ${issue.message}`);
    console.log(result.ok ? `Production configuration passed (${result.profile}).` : `Production configuration failed (${result.profile}).`);
  }
  if (!result.ok) process.exitCode = 1;
}
