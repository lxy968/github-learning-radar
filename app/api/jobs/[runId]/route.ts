import { NextResponse } from "next/server";
import { getJobRun } from "@/lib/job-runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const normalizedRunId = decodeURIComponent(runId).trim();

  if (!normalizedRunId || normalizedRunId.length > 180) {
    return NextResponse.json({ status: "error", message: "runId 无效。" }, { status: 400 });
  }

  const job = await getJobRun(normalizedRunId);
  if (!job) {
    return NextResponse.json({ status: "error", message: "没有找到这个任务。" }, { status: 404 });
  }

  return NextResponse.json(
    {
      status: "success",
      job: {
        runId: job.runId,
        jobName: job.jobName,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        summary: job.summary,
        errorSummary: job.errorSummary,
        errorCategory: job.errorCategory,
        createdAt: job.createdAt,
        availableAt: job.availableAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        heartbeatAt: job.heartbeatAt,
        updatedAt: job.updatedAt
      }
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
