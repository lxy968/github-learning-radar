import { NextResponse } from "next/server";
import { isShowcaseMode, showcaseReadOnlyError } from "@/lib/deployment-mode";
import { getPublicRadarPreference } from "@/lib/preferences";
import { enqueueDailyRadarJob, scheduleLocalRadarJob } from "@/lib/radar-jobs";
import { getLatestRadarRun } from "@/lib/radar-runs";
import { getRefreshScheduleDecision } from "@/lib/refresh-schedule";

export async function GET(request: Request) {
  if (isShowcaseMode()) {
    return NextResponse.json(showcaseReadOnlyError, {
      status: 403,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const secret = request.headers.get("authorization")?.replace("Bearer ", "");

  if (process.env.NODE_ENV === "production" && !process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is required in production" }, { status: 503 });
  }

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!force) {
    const preference = await getPublicRadarPreference();
    const latestRun = await getLatestRadarRun();
    const decision = getRefreshScheduleDecision(latestRun, preference.refreshInterval);

    if (!decision.shouldRun) {
      return NextResponse.json({
        status: "skipped",
        reason: decision.reason,
        nextSuggestedRefreshAt: decision.nextSuggestedRefreshAt
      });
    }
  }

  const { job, created } = await enqueueDailyRadarJob({ trigger: "cron", force });
  if (job.status === "queued") scheduleLocalRadarJob(job.runId);

  return NextResponse.json(
    {
      status: job.status,
      created,
      reused: !created,
      runId: job.runId,
      statusUrl: `/api/jobs/${encodeURIComponent(job.runId)}`
    },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
}
