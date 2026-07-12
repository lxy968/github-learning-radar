import { NextResponse } from "next/server";
import { getCurrentRecommendations } from "@/lib/radar";
import { getLatestRadarRun } from "@/lib/radar-runs";

export async function GET() {
  const latestRun = await getLatestRadarRun();

  return NextResponse.json({
    date: latestRun?.date ?? "seed",
    run: latestRun
      ? {
          runId: latestRun.runId,
          source: latestRun.source,
          status: latestRun.status,
          finishedAt: latestRun.finishedAt,
          recommendationCount: latestRun.recommendationCount,
          notes: latestRun.notes
        }
      : null,
    recommendations: await getCurrentRecommendations()
  });
}
