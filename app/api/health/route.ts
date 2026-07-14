import { NextResponse } from "next/server";
import { redactOperationalError } from "@/lib/api-security";
import { getSqlClient } from "@/lib/db/client";
import { getJobQueueHealth } from "@/lib/job-runs";
import { detailedStudyPlanJobName } from "@/lib/study-plan-jobs";

const dailyRadarJobName = "daily-radar";

export async function GET() {
  const sql = getSqlClient();
  const checkedAt = new Date().toISOString();
  const staleAfterMs = readBoundedInteger(process.env.RADAR_JOB_STALE_AFTER_MS, 5 * 60_000, 30_000, 60 * 60_000);

  if (!sql) {
    const production = process.env.NODE_ENV === "production";
    try {
      const taskQueue = await getJobQueueHealth(dailyRadarJobName, new Date(), staleAfterMs);
      const studyPlanQueue = await getJobQueueHealth(detailedStudyPlanJobName, new Date(), 10 * 60_000);
      return NextResponse.json(
        {
          status: production ? "degraded" : taskQueue.staleRunning > 0 ? "degraded" : "ok",
          storage: "local-json",
          checkedAt,
          taskQueue,
          studyPlanQueue,
          message: production ? "DATABASE_URL is required for reliable multi-instance deployment." : "Local development storage is active."
        },
        { status: production ? 503 : 200 }
      );
    } catch (error) {
      return NextResponse.json(
        { status: "error", storage: "local-json", checkedAt, detail: redactOperationalError(error) },
        { status: 503 }
      );
    }
  }

  try {
    await sql`SELECT 1 AS healthy`;
    const taskQueue = await getJobQueueHealth(dailyRadarJobName, new Date(), staleAfterMs);
    const studyPlanQueue = await getJobQueueHealth(detailedStudyPlanJobName, new Date(), 10 * 60_000);
    const degraded = taskQueue.staleRunning > 0 || taskQueue.queued >= 10 || studyPlanQueue.staleRunning > 0;
    return NextResponse.json(
      { status: degraded ? "degraded" : "ok", storage: "postgres", checkedAt, taskQueue, studyPlanQueue },
      { status: degraded ? 503 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        storage: "postgres",
        checkedAt,
        detail: process.env.NODE_ENV === "development" ? redactOperationalError(error) : undefined
      },
      { status: 503 }
    );
  }
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
