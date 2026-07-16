import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "github-learning-radar-release-"));
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const siteUrl = "https://radar.example.invalid";
const logs = [];

const environment = {
  ...process.env,
  NODE_ENV: "production",
  APP_DEPLOYMENT_MODE: "showcase",
  SITE_URL: siteUrl,
  REGRESSION_EXPECTED_SITE_URL: siteUrl,
  REGRESSION_EXPECTED_DEPLOYMENT_MODE: "showcase",
  REGRESSION_BASE_URL: baseUrl,
  HOSTNAME: "127.0.0.1",
  PORT: String(port),
  DATABASE_URL: "",
  GITHUB_TOKEN: "",
  DEEPSEEK_API_KEY: "",
  OPENAI_API_KEY: "",
  ADMIN_SECRET: "",
  CRON_SECRET: "",
  ANONYMOUS_SESSION_STORE_FILE: path.join(temporaryRoot, "sessions.json"),
  DETAILED_STUDY_PLAN_STORE_FILE: path.join(temporaryRoot, "plans.json"),
  JOB_RUN_STORE_FILE: path.join(temporaryRoot, "jobs.json"),
  LEARNING_PROGRESS_STORE_FILE: path.join(temporaryRoot, "progress.json"),
  PREFERENCE_STORE_FILE: path.join(temporaryRoot, "preferences.json"),
  RADAR_RUN_ARCHIVE_FILE: path.join(temporaryRoot, "radar-archive.json"),
  RADAR_RUN_STORE_FILE: path.join(temporaryRoot, "radar.json"),
  REPOSITORY_STORE_FILE: path.join(temporaryRoot, "repositories.json"),
  USER_STATE_STORE_FILE: path.join(temporaryRoot, "user-state.json")
};

const app = spawn(process.execPath, [path.join(root, ".next", "standalone", "server.js")], {
  cwd: root,
  env: environment,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

capture(app.stdout);
capture(app.stderr);

try {
  await waitForServer(`${baseUrl}/`);
  await run(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/http-regression.ts"], environment);
  console.log(`Release HTTP regression passed against ${baseUrl}`);
} catch (error) {
  if (logs.length > 0) console.error(logs.join(""));
  throw error;
} finally {
  if (!app.killed) app.kill();
  await Promise.race([onceExit(app), delay(3_000)]);
  await rm(temporaryRoot, { recursive: true, force: true });
}

function capture(stream) {
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk) => {
    logs.push(String(chunk));
    if (logs.join("").length > 20_000) logs.splice(0, logs.length - 20);
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const selectedPort = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!selectedPort) throw new Error("Unable to reserve a local regression port.");
  return selectedPort;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (app.exitCode !== null) throw new Error(`Standalone server exited with code ${app.exitCode}.`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The standalone process may still be binding its port.
    }
    await delay(500);
  }
  throw new Error("Standalone server did not become ready within 20 seconds.");
}

async function run(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true
  });
  const code = await onceExit(child);
  if (code !== 0) throw new Error(`${path.basename(command)} exited with code ${code}.`);
}

function onceExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
