import { claimNextJobRun, recoverStaleJobRuns } from "@/lib/job-runs";
import {
  dailyRadarJobName,
  executeClaimedDailyRadarJob
} from "@/lib/radar-jobs";

type ExecutionOptions = NonNullable<Parameters<typeof executeClaimedDailyRadarJob>[1]>;

export async function runRadarWorkerOnce(
  options: ExecutionOptions & {
    now?: Date;
    staleAfterMs?: number;
  } = {}
) {
  const now = options.now ?? new Date();
  const staleAfterMs = Math.max(30_000, Math.round(options.staleAfterMs ?? 5 * 60_000));
  const recovery = await recoverStaleJobRuns({
    jobName: dailyRadarJobName,
    staleBefore: new Date(now.getTime() - staleAfterMs),
    now
  });
  const claimed = await claimNextJobRun(dailyRadarJobName, "load-preferences", now);

  if (!claimed) {
    return {
      status: "idle" as const,
      job: null,
      recovery
    };
  }

  const job = await executeClaimedDailyRadarJob(claimed, {
    runner: options.runner,
    heartbeatIntervalMs: options.heartbeatIntervalMs
  });
  return {
    status: "processed" as const,
    job,
    recovery
  };
}
