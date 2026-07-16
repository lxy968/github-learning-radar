import { loadLocalEnv } from "./load-local-env";
import { assertBackgroundJobsEnabled } from "../lib/deployment-mode";
import { runFairWorkerCycle, type WorkerKind } from "../lib/worker-scheduler";

loadLocalEnv();

const once = process.argv.includes("--once");
const pollIntervalMs = readBoundedInteger(process.env.RADAR_WORKER_POLL_MS, 5_000, 1_000, 60_000);
const staleAfterMs = readBoundedInteger(process.env.RADAR_JOB_STALE_AFTER_MS, 5 * 60_000, 30_000, 60 * 60_000);
let stopping = false;
let wakeWorker: (() => void) | null = null;
let preferredWorkerKind: WorkerKind = "study-plan";

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertBackgroundJobsEnabled("radar worker startup");
  const { runRadarWorkerOnce } = await import("../lib/radar-worker");
  const { runStudyPlanWorkerOnce } = await import("../lib/study-plan-worker");
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required for the production radar worker.");
  }

  do {
    const cycle = await runFairWorkerCycle(preferredWorkerKind, {
      studyPlan: () => runStudyPlanWorkerOnce({
        staleAfterMs: readBoundedInteger(
          process.env.STUDY_PLAN_JOB_STALE_AFTER_MS,
          10 * 60_000,
          5 * 60_000,
          60 * 60_000
        )
      }),
      radar: () => runRadarWorkerOnce({ staleAfterMs })
    });
    preferredWorkerKind = cycle.nextPreferredKind;
    const result = cycle.result;
    if (result.recovery.requeuedRunIds.length || result.recovery.failedRunIds.length) {
      console.log(
        `recovered=${result.recovery.requeuedRunIds.length} failed_stale=${result.recovery.failedRunIds.length}`
      );
    }
    if (result.status === "processed") {
      console.log(`runId=${result.job.runId} status=${result.job.status} attempts=${result.job.attemptCount}`);
    }
    if (once || stopping) break;
    await wait(pollIntervalMs);
  } while (!stopping);
}

function stop() {
  stopping = true;
  wakeWorker?.();
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      wakeWorker = null;
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    wakeWorker = finish;
    if (stopping) finish();
  });
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
