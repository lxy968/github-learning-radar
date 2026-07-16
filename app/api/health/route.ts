import { NextResponse } from "next/server";
import { redactOperationalError } from "@/lib/api-security";
import { getSqlClient } from "@/lib/db/client";
import { getJobQueueDegradationReasons } from "@/lib/job-health";
import { getJobQueueHealth } from "@/lib/job-runs";
import { detailedStudyPlanJobName } from "@/lib/study-plan-jobs";

const dailyRadarJobName = "daily-radar";

export async function GET() {
  const sql = getSqlClient();
  const now = new Date();
  const checkedAt = now.toISOString();
  const radarStaleAfterMs = readBoundedInteger(
    process.env.RADAR_JOB_STALE_AFTER_MS,
    5 * 60_000,
    30_000,
    60 * 60_000
  );
  const studyPlanStaleAfterMs = readBoundedInteger(
    process.env.STUDY_PLAN_JOB_STALE_AFTER_MS,
    10 * 60_000,
    5 * 60_000,
    60 * 60_000
  );
  const radarQueueDegradedAfterMs = readBoundedInteger(
    process.env.RADAR_QUEUE_DEGRADED_AFTER_MS,
    10 * 60_000,
    60_000,
    24 * 60 * 60_000
  );
  const studyPlanQueueDegradedAfterMs = readBoundedInteger(
    process.env.STUDY_PLAN_QUEUE_DEGRADED_AFTER_MS,
    30 * 60_000,
    5 * 60_000,
    24 * 60 * 60_000
  );

  if (!sql) {
    const production = process.env.NODE_ENV === "production";
    try {
      const taskQueue = await getJobQueueHealth(dailyRadarJobName, now, radarStaleAfterMs);
      const studyPlanQueue = await getJobQueueHealth(detailedStudyPlanJobName, now, studyPlanStaleAfterMs);
      const degradedReasons = getDegradedReasons(taskQueue, studyPlanQueue, now, {
        radarQueueDegradedAfterMs,
        studyPlanQueueDegradedAfterMs
      });
      return NextResponse.json(
        {
          status: production || degradedReasons.length > 0 ? "degraded" : "ok",
          storage: "local-json",
          checkedAt,
          taskQueue,
          studyPlanQueue,
          degradedReasons,
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
    const taskQueue = await getJobQueueHealth(dailyRadarJobName, now, radarStaleAfterMs);
    const studyPlanQueue = await getJobQueueHealth(detailedStudyPlanJobName, now, studyPlanStaleAfterMs);
    const degradedReasons = getDegradedReasons(taskQueue, studyPlanQueue, now, {
      radarQueueDegradedAfterMs,
      studyPlanQueueDegradedAfterMs
    });
    const degraded = degradedReasons.length > 0;
    return NextResponse.json(
      {
        status: degraded ? "degraded" : "ok",
        storage: "postgres",
        checkedAt,
        taskQueue,
        studyPlanQueue,
        degradedReasons
      },
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

function getDegradedReasons(
  taskQueue: Awaited<ReturnType<typeof getJobQueueHealth>>,
  studyPlanQueue: Awaited<ReturnType<typeof getJobQueueHealth>>,
  now: Date,
  thresholds: { radarQueueDegradedAfterMs: number; studyPlanQueueDegradedAfterMs: number }
) {
  return [
    ...getJobQueueDegradationReasons("radar", taskQueue, now, {
      maxReadyQueued: 10,
      maxReadyWaitMs: thresholds.radarQueueDegradedAfterMs
    }),
    ...getJobQueueDegradationReasons("study_plan", studyPlanQueue, now, {
      maxReadyQueued: 10,
      maxReadyWaitMs: thresholds.studyPlanQueueDegradedAfterMs
    })
  ];
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
