import { spawnSync } from "node:child_process";
import { accessSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const errors: string[] = [];
const warnings: string[] = [];
const requiredFiles = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "DEPLOYMENT.md",
  "OPERATIONS.md",
  "DATA_MODEL.md",
  "DATA_RETENTION.md",
  "CHANGELOG.md",
  "RELEASE_CHECKLIST.md",
  "RELEASE_READINESS.md",
  "Dockerfile",
  "vercel.json",
  ".dockerignore",
  "compose.integration.yml",
  ".env.example",
  ".gitignore",
  "package.json",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  ".github/workflows/daily-radar.yml",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  "public/.gitkeep",
  "scripts/prepare-standalone.mjs",
  "scripts/git-history-secret-scan.ts",
  "scripts/postgres-integration-safety.ts",
  "scripts/postgres-integration.ts",
  "scripts/production-check.mjs"
];
const requiredIgnoreRules = [
  "node_modules",
  ".next",
  ".vercel",
  ".pnpm-store",
  ".agents",
  "dist",
  "coverage",
  "*.tsbuildinfo",
  "*.log",
  ".env",
  ".env.local",
  ".env.*.local",
  ".data",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "credentials*.json",
  "service-account*.json"
];
const requiredDockerIgnoreRules = [
  ".git",
  ".data",
  ".next",
  ".pnpm-store",
  "node_modules",
  "*.log",
  ".env",
  ".env.local",
  ".env.*.local",
  "*.pem",
  "*.key",
  "credentials*.json",
  "service-account*.json"
];
const ignoredDirectories = new Set([
  ".agents",
  ".data",
  ".git",
  ".next",
  ".pnpm-store",
  ".vercel",
  "node_modules",
  "dist",
  "coverage"
]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sql", ".yml", ".yaml", ".toml"]);
const secretPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/ },
  { label: "API secret key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: "credentialed database URL", pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i },
  { label: "literal bearer token", pattern: /Bearer\s+[A-Za-z0-9._~-]{24,}/i }
];

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function main() {
  await verifyRequiredFiles();
  await verifyGitignore();
  await verifyContainerArtifacts();
  await verifyVercelDeploymentConfig();
  await verifyEnvironmentExample();
  await verifyPackageMetadata();
  await scanRepositoryText();
  verifyWorkflows();
  verifyGitState();

  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    console.error(`Repository hygiene failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  console.log(`Repository hygiene passed${warnings.length > 0 ? ` with ${warnings.length} warning(s)` : ""}.`);
}

async function verifyRequiredFiles() {
  for (const file of requiredFiles) {
    if (!(await exists(path.join(root, file)))) errors.push(`Missing required release file: ${file}`);
  }
}

async function verifyGitignore() {
  const gitignore = await readText(".gitignore");
  const rules = new Set(
    gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
  for (const rule of findMissingGitignoreRules(gitignore)) errors.push(`.gitignore is missing required rule: ${rule}`);
  if (rules.has(".env.example")) errors.push(".env.example must remain committable.");
}

async function verifyContainerArtifacts() {
  const dockerignore = await readText(".dockerignore");
  const dockerignoreRules = new Set(
    dockerignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
  for (const rule of requiredDockerIgnoreRules) {
    if (!dockerignoreRules.has(rule)) errors.push(`.dockerignore is missing required rule: ${rule}`);
  }
  if (dockerignoreRules.has(".env.example")) errors.push(".env.example must remain available to container builds.");

  const dockerfile = await readText("Dockerfile");
  for (const marker of [
    "AS web",
    "AS worker",
    "FROM worker-dependencies AS worker",
    "USER node",
    "HEALTHCHECK",
    "production-check.mjs --profile=web",
    "production-check.mjs --profile=worker",
    "exec node server.js",
    "exec pnpm worker:radar"
  ]) {
    if (!dockerfile.includes(marker)) errors.push(`Dockerfile is missing production marker: ${marker}`);
  }
  if (/COPY\s+[^\n]*\.env(?:\s|$)/i.test(dockerfile)) {
    errors.push("Dockerfile must not copy environment files into an image.");
  }
  const standalonePackager = await readText("scripts/prepare-standalone.mjs");
  for (const marker of ["public", ".next", "static", "production-check.mjs"]) {
    if (!standalonePackager.includes(marker)) errors.push(`Standalone packager is missing: ${marker}`);
  }

  const compose = await readText("compose.integration.yml");
  for (const marker of [
    "postgres:16-alpine",
    "radar_local_integration_only",
    "service_healthy",
    'ALLOW_POSTGRES_INTEGRATION_TEST: "1"',
    'DEEPSEEK_API_KEY: ""',
    'GITHUB_TOKEN: ""'
  ]) {
    if (!compose.includes(marker)) errors.push(`PostgreSQL integration compose file is missing: ${marker}`);
  }
}

async function verifyVercelDeploymentConfig() {
  try {
    const config = JSON.parse(await readText("vercel.json")) as unknown;
    for (const issue of findVercelDeploymentConfigIssues(config)) errors.push(`vercel.json: ${issue}`);
  } catch {
    errors.push("vercel.json is not valid JSON.");
  }
}

async function verifyEnvironmentExample() {
  const content = await readText(".env.example");
  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      errors.push(`Invalid .env.example line: ${line.slice(0, 40)}`);
      continue;
    }
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  for (const key of ["GITHUB_TOKEN", "DEEPSEEK_API_KEY", "DATABASE_URL", "CRON_SECRET", "ADMIN_SECRET"]) {
    if (!values.has(key)) errors.push(`.env.example is missing ${key}.`);
    else if (values.get(key)?.trim()) errors.push(`.env.example must not contain a value for ${key}.`);
  }
  if (!values.has("SITE_URL")) errors.push(".env.example is missing SITE_URL.");
  if (values.get("APP_DEPLOYMENT_MODE") !== "showcase") {
    errors.push(".env.example must default APP_DEPLOYMENT_MODE to the fail-closed showcase mode.");
  }
  if (values.has("NEXT_PUBLIC_SITE_URL")) errors.push("Use runtime SITE_URL instead of build-time NEXT_PUBLIC_SITE_URL.");
}

async function verifyPackageMetadata() {
  try {
    const packageJson = JSON.parse(await readText("package.json")) as {
      private?: unknown;
      version?: unknown;
      description?: unknown;
      keywords?: unknown;
      license?: unknown;
      packageManager?: unknown;
      engines?: { node?: unknown };
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    if (packageJson.private !== true) errors.push("package.json should keep private=true to prevent accidental npm publish.");
    if (typeof packageJson.description !== "string" || packageJson.description.trim().length < 20) {
      errors.push("package.json must contain a meaningful project description.");
    }
    if (!Array.isArray(packageJson.keywords) || packageJson.keywords.length < 3) {
      errors.push("package.json must contain at least three discovery keywords.");
    }
    if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
      errors.push("package.json must contain a semantic version.");
    }
    if (packageJson.license !== "MIT") errors.push("package.json license must match the MIT LICENSE file.");
    if (typeof packageJson.packageManager !== "string" || !packageJson.packageManager.startsWith("pnpm@")) {
      errors.push("package.json must pin the pnpm packageManager version.");
    }
    if (typeof packageJson.engines?.node !== "string") errors.push("package.json must declare the supported Node.js version.");
    for (const script of [
      "start",
      "start:regression",
      "repo:hygiene",
      "history:secrets",
      "audit:prod",
      "release:check",
      "production:check",
      "typecheck",
      "verify",
      "build",
      "db:integration",
      "db:migrate:production"
    ]) {
      if (typeof packageJson.scripts?.[script] !== "string") errors.push(`package.json is missing release script: ${script}`);
    }
    if (typeof packageJson.dependencies?.tsx !== "string") {
      errors.push("tsx must be a production dependency because the containerized Worker executes TypeScript entry points.");
    }
    if (packageJson.devDependencies?.tsx !== undefined) {
      errors.push("tsx must not remain duplicated in devDependencies.");
    }
    if (
      typeof packageJson.scripts?.start !== "string" ||
      !packageJson.scripts.start.includes("production-check.mjs --profile=web") ||
      !packageJson.scripts.start.includes(".next/standalone/server.js")
    ) {
      errors.push("start must preflight and execute the same standalone server artifact used by the Web container.");
    }
    if (typeof packageJson.scripts?.build !== "string" || !packageJson.scripts.build.includes("prepare-standalone.mjs")) {
      errors.push("build must package public, static assets, and production preflight into the standalone artifact.");
    }
    if (typeof packageJson.version === "string") {
      const releaseNotesPath = `RELEASE_NOTES_v${packageJson.version}.md`;
      if (!(await exists(path.join(root, releaseNotesPath)))) {
        errors.push(`Missing release notes for package version: ${releaseNotesPath}`);
      } else {
        const releaseNotes = await readText(releaseNotesPath);
        if (!releaseNotes.includes(`v${packageJson.version}`) || !releaseNotes.includes("已知限制")) {
          errors.push(`${releaseNotesPath} must include its version and known limitations.`);
        }
      }
      const changelog = await readText("CHANGELOG.md");
      if (!changelog.includes("## [Unreleased]")) errors.push("CHANGELOG.md must keep an Unreleased section.");
      const readme = await readText("README.md");
      if (!readme.includes(`v${packageJson.version}`) || !readme.includes("## 架构") || !readme.includes("## 已知限制")) {
        errors.push("README.md must include the current version, architecture, and known limitations.");
      }
    }
  } catch {
    errors.push("package.json is not valid JSON.");
  }
}

async function scanRepositoryText() {
  const files = await listFiles(root);
  for (const file of files) {
    const relative = normalizePath(path.relative(root, file));
    if (relative === ".env.local" || relative === ".env" || relative.endsWith(".local")) continue;
    if (!textExtensions.has(path.extname(file).toLowerCase()) && path.basename(file) !== "Dockerfile") continue;
    const stat = await fs.stat(file);
    if (stat.size > 1_000_000) continue;
    const content = await fs.readFile(file, "utf8");
    for (const finding of findPotentialSecrets(content)) {
      const line = content.slice(0, finding.index).split(/\r?\n/).length;
      errors.push(`Possible ${finding.label} in ${relative}:${line}.`);
    }
  }
}

function verifyWorkflows() {
  const ci = readTextSyncSafe(".github/workflows/ci.yml");
  for (const marker of [
    "permissions:",
    "contents: read",
    "actions/checkout@v7",
    "pnpm/action-setup@v4.4.0",
    "actions/setup-node@v6",
    "pnpm install --frozen-lockfile",
    "pnpm repo:hygiene -- --strict",
    "pnpm history:secrets",
    "pnpm audit:prod",
    "pnpm typecheck",
    "pnpm verify",
    "pnpm production:check -- --profile=web",
    "pnpm build",
    "pnpm regression:http",
    "pnpm start:regression",
    "REGRESSION_EXPECTED_SITE_URL",
    "docker build --target web",
    "docker compose -f compose.integration.yml",
    "pnpm db:integration"
  ]) {
    if (!ci.includes(marker)) errors.push(`CI workflow is missing: ${marker}`);
  }
  if (ci.includes("pull_request_target")) errors.push("CI must not use pull_request_target for untrusted code.");
  const daily = readTextSyncSafe(".github/workflows/daily-radar.yml");
  if (daily && (!daily.includes("secrets.CRON_SECRET") || !daily.includes("secrets.RADAR_CRON_URL"))) {
    errors.push("Daily radar workflow must use GitHub secrets for its URL and authorization.");
  }
  if (daily && (!daily.includes("permissions:") || !daily.includes("contents: read") || !daily.includes('test -n "$CRON_SECRET"'))) {
    errors.push("Daily radar workflow must use read-only permissions and reject a missing CRON_SECRET.");
  }
}

function verifyGitState() {
  const git = spawnSync("git", ["--version"], { cwd: root, encoding: "utf8", shell: false });
  const hasHead = existsSyncSafe(path.join(root, ".git", "HEAD"));
  const hasIndex = existsSyncSafe(path.join(root, ".git", "index"));
  if (git.status !== 0 || !hasHead || !hasIndex) {
    const message = "Git executable or initialized HEAD/index is unavailable; tracked-file and commit checks were skipped.";
    if (strict) errors.push(message);
    else warnings.push(message);
    return;
  }

  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", shell: false });
  if (tracked.status !== 0) {
    const message = "git ls-files failed; tracked-file checks could not run.";
    if (strict) errors.push(message);
    else warnings.push(message);
    return;
  }
  const forbiddenTracked = tracked.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => /(^|\/)\.env(?:$|\.)|(^|\/)\.data\/|\.(?:pem|key|p12|pfx)$/i.test(file))
    .filter((file) => file !== ".env.example");
  for (const file of forbiddenTracked) errors.push(`Sensitive or local file is tracked by Git: ${file}`);
}

async function listFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await listFiles(fullPath)));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

async function readText(relativePath: string) {
  try {
    return await fs.readFile(path.join(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

function readTextSyncSafe(relativePath: string) {
  try {
    return readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function existsSyncSafe(file: string) {
  try {
    accessSync(file);
    return true;
  } catch {
    return false;
  }
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

export function findMissingGitignoreRules(content: string) {
  const rules = new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
  return requiredIgnoreRules.filter((rule) => !rules.has(rule));
}

export function findPotentialSecrets(content: string) {
  const findings: Array<{ label: string; index: number }> = [];
  for (const { label, pattern } of secretPatterns) {
    const match = pattern.exec(content);
    if (!match) continue;
    if (label === "literal bearer token" && /^Bearer\s+(?:verification|test|simulated)-/i.test(match[0])) continue;
    if (
      label === "credentialed database URL" &&
      /^postgresql:\/\/radar:radar_local_integration_only@$/i.test(match[0])
    ) continue;
    findings.push({ label, index: match.index });
  }
  return findings;
}

export function findVercelDeploymentConfigIssues(value: unknown) {
  const issues: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["configuration must be an object."];

  const config = value as Record<string, unknown>;
  if (config.framework !== "nextjs") issues.push("framework must remain nextjs.");
  if (config.buildCommand !== "pnpm production:check -- --profile=web && pnpm build") {
    issues.push("buildCommand must run the Web production preflight before the production build.");
  }
  for (const forbiddenField of ["env", "build.env", "crons"]) {
    if (forbiddenField in config) {
      issues.push(`${forbiddenField} must not be committed; configure runtime values in Vercel and keep showcase cron-free.`);
    }
  }
  return issues;
}
