import { createHash } from "node:crypto";
import { repositoryAnalysisPromptVersion, repositoryAnalysisSchemaVersion } from "@/lib/ai/analyze";
import type { RadarRun } from "@/lib/types";

export const publicRadarProjectionUserId = "system-radar";

export type RadarRunProjection = ReturnType<typeof createRadarRunProjection>;

export function createRadarRunProjection(run: RadarRun) {
  const scores = run.recommendations.map((item) => ({
    githubId: item.repo.id,
    runId: run.runId,
    ...item.score
  }));
  const analyses = run.recommendations.map((item) => {
    const attempt = item.analysisTrace?.providerAttempts[0];
    const source = item.analysisTrace?.source ?? "legacy";
    return {
      githubId: item.repo.id,
      runId: run.runId,
      promptVersion: repositoryAnalysisPromptVersion,
      schemaVersion: repositoryAnalysisSchemaVersion,
      inputHash: hashAnalysisInput(item, run),
      model: attempt?.modelId ?? (source === "rule" ? "rule-v1" : source === "seed" ? "seed" : "legacy"),
      source,
      fallbackReason: item.analysisTrace?.fallbackReason,
      providerAttempts: item.analysisTrace?.providerAttempts ?? [],
      analysis: item.analysis,
      confidence: item.analysis.confidence
    };
  });
  const recommendations = run.recommendations.map((item) => ({
    githubId: item.repo.id,
    runId: run.runId,
    userId: publicRadarProjectionUserId,
    recommendationDate: run.date,
    rank: item.rank,
    score: item.score.finalScore,
    reason: item.score.reasons[0] ?? item.analysis.oneLineSummary,
    analysisSource: item.analysisTrace?.source ?? "legacy"
  }));

  const projection = { scores, analyses, recommendations };
  assertRadarRunProjection(run, projection);
  return projection;
}

export function assertRadarRunProjection(run: RadarRun, projection: {
  scores: Array<{ githubId: number }>;
  analyses: Array<{ githubId: number }>;
  recommendations: Array<{ githubId: number; rank: number }>;
}) {
  const expected = run.recommendations.length;
  if (run.recommendationCount !== expected) {
    throw new Error(`Radar snapshot recommendation count mismatch for ${run.runId}.`);
  }
  if (
    projection.scores.length !== expected ||
    projection.analyses.length !== expected ||
    projection.recommendations.length !== expected
  ) {
    throw new Error(`Radar projection count mismatch for ${run.runId}.`);
  }

  const recommendationIds = new Set(projection.recommendations.map((item) => item.githubId));
  const ranks = new Set(projection.recommendations.map((item) => item.rank));
  if (recommendationIds.size !== expected || ranks.size !== expected) {
    throw new Error(`Radar projection contains duplicate repository ids or ranks for ${run.runId}.`);
  }
}

function hashAnalysisInput(item: RadarRun["recommendations"][number], run: RadarRun) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        repo: {
          id: item.repo.id,
          fullName: item.repo.fullName,
          description: item.repo.description,
          primaryLanguage: item.repo.primaryLanguage,
          topics: [...item.repo.topics].sort(),
          pushedAt: item.repo.pushedAt,
          readmeExcerpt: item.repo.readmeExcerpt,
          detectedFiles: [...item.repo.detectedFiles].sort(),
          dependencies: [...item.repo.dependencies].sort(),
          enrichment: item.repo.enrichment
        },
        score: item.score,
        preference: run.preference ?? null
      })
    )
    .digest("hex");
}
