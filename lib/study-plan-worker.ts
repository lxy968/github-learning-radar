import { claimNextJobRun, recoverStaleJobRuns } from "@/lib/job-runs";
import {
  detailedStudyPlanJobName,
  executeDetailedStudyPlanJob
} from "@/lib/study-plan-jobs";

type ExecutionOptions = NonNullable<Parameters<typeof executeDetailedStudyPlanJob>[1]>;

export async function runStudyPlanWorkerOnce(
  options: ExecutionOptions & { now?: Date; staleAfterMs?: number } = {}
) {
  const now = options.now ?? new Date();
  const staleAfterMs = Math.max(5 * 60_000, Math.round(options.staleAfterMs ?? 10 * 60_000));
  const recovery = await recoverStaleJobRuns({
    jobName: detailedStudyPlanJobName,
    staleBefore: new Date(now.getTime() - staleAfterMs),
    now
  });
  const claimed = await claimNextJobRun(detailedStudyPlanJobName, "prepare-study-plan", now);

  if (!claimed) return { status: "idle" as const, job: null, recovery };
  const job = await executeDetailedStudyPlanJob(claimed.runId, { ...options, claimedJob: claimed });
  return { status: "processed" as const, job, recovery };
}
