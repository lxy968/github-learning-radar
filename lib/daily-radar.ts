import {
  analyzeRepositoryWithFallback,
  createRuleBasedAnalysis,
  type RepositoryAnalysisResult
} from "@/lib/ai/analyze";
import { discoverGithubCandidates } from "@/lib/github/discovery";
import { getPublicRadarPreference, getUserPreference } from "@/lib/preferences";
import { getRecommendations } from "@/lib/radar";
import { classifyOperationalError } from "@/lib/operational-errors";
import { saveRadarRun } from "@/lib/radar-runs";
import { persistRepositorySnapshots } from "@/lib/repository-store";
import { scoreRepository } from "@/lib/scoring";
import { defaultPreference } from "@/lib/seed-data";
import type { RadarRecommendation, RadarRun, RepoSnapshot } from "@/lib/types";

const maxRecommendedCandidates = readBoundedInteger(process.env.RADAR_RECOMMENDATION_LIMIT, 6, 1, 24);
const maxAiCandidates = readBoundedInteger(process.env.RADAR_MAX_ANALYZED_CANDIDATES, 3, 0, 24);

type ScoredCandidate = {
  repo: RepoSnapshot;
  score: RadarRecommendation["score"];
};

type AnalyzeFn = typeof analyzeRepositoryWithFallback;
export type RadarRefreshStage =
  | "load-preferences"
  | "github-discovery"
  | "persist-repository-snapshots"
  | "rule-scoring"
  | "save-recovery-checkpoint"
  | "ai-analysis"
  | "save-final-run"
  | "save-fallback-run";

export type DailyRadarActivity =
  | {
      status: "idle";
      lastRunId?: string;
      updatedAt: string;
    }
  | {
      status: "running";
      runId: string;
      stage: RadarRefreshStage;
      startedAt: string;
      updatedAt: string;
      progress?: {
        completed: number;
        total: number;
      };
    };

export type DailyRadarRunOptions = {
  runId?: string;
  startedAt?: Date;
  onStage?: (
    stage: RadarRefreshStage,
    progress?: { completed: number; total: number }
  ) => void | Promise<void>;
};

let activeRadarRun: Promise<RadarRun> | null = null;
let radarActivity: DailyRadarActivity = {
  status: "idle",
  updatedAt: new Date(0).toISOString()
};

export function isDailyRadarRunning() {
  return activeRadarRun !== null;
}

export function getDailyRadarActivity(): DailyRadarActivity {
  return { ...radarActivity };
}

export function runDailyRadar(options: DailyRadarRunOptions = {}) {
  if (activeRadarRun) return activeRadarRun;

  const runPromise = executeDailyRadar(options);
  activeRadarRun = runPromise;
  const clearActiveRun = (lastRunId?: string) => {
    if (activeRadarRun === runPromise) activeRadarRun = null;
    radarActivity = {
      status: "idle",
      lastRunId,
      updatedAt: new Date().toISOString()
    };
  };
  runPromise.then((run) => clearActiveRun(run.runId), () => clearActiveRun());
  return runPromise;
}

async function executeDailyRadar(options: DailyRadarRunOptions) {
  const startedAt = options.startedAt ?? new Date();
  const runId = options.runId ?? `daily-radar-${startedAt.toISOString()}`;
  const notes: string[] = [];
  let source: RadarRun["source"] = "seed";
  let candidates: RepoSnapshot[] = [];
  let preference = defaultPreference;
  let discoveryMetrics = { queryCount: 0, failedQueryCount: 0, enrichedRepositoryCount: 0 };
  let scoredCandidateCount = 0;
  let stage: RadarRefreshStage = "load-preferences";
  let latestUsableRecommendations: RadarRecommendation[] = [];
  let stageUpdateQueue = Promise.resolve();
  const setStage = (nextStage: RadarRefreshStage, progress?: { completed: number; total: number }) => {
    stage = nextStage;
    radarActivity = {
      status: "running",
      runId,
      stage: nextStage,
      startedAt: startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
      progress
    };
    stageUpdateQueue = stageUpdateQueue.then(() => options.onStage?.(nextStage, progress));
    return stageUpdateQueue;
  };
  await setStage("load-preferences");

  try {
    preference = await getPublicRadarPreference();
    await setStage("github-discovery");
    const discovery = await discoverGithubCandidates();
    source = discovery.source;
    candidates = discovery.repositories;
    discoveryMetrics = discovery.metrics;
    notes.push(discovery.message);
    if (discovery.warnings?.length) {
      notes.push(...discovery.warnings.slice(0, 6));
    }

    if (candidates.length === 0) {
      candidates = getRecommendations(preference).map((item) => item.repo);
      source = "seed";
      notes.push("Using seed repositories because no live GitHub candidates were available.");
    }

    if (source === "github") {
      await setStage("persist-repository-snapshots");
      candidates = await persistRepositorySnapshots(candidates, toDateKey(startedAt));
      notes.push(`Persisted ${candidates.length} repositories and daily metric snapshots.`);
    }

    await setStage("rule-scoring");
    const scored = candidates
      .map((repo) => ({
        repo,
        score: scoreRepository(repo, preference)
      }))
      .sort((a, b) => b.score.finalScore - a.score.finalScore)
      .slice(0, maxRecommendedCandidates);
    scoredCandidateCount = scored.length;

    latestUsableRecommendations = scored.map((item, index) => ({
      repo: item.repo,
      score: item.score,
      analysis: createRuleBasedAnalysis(item.repo, item.score, preference),
      rank: index + 1,
      analysisTrace: {
        source: "rule",
        providerAttempts: []
      }
    }));
    notes.push("Prepared a rule-based recovery checkpoint before AI analysis.");

    await setStage("save-recovery-checkpoint");
    await saveRadarRun({
      runId,
      date: toDateKey(startedAt),
      source,
      status: "partial",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      rawCandidateCount: candidates.length,
      recommendationCount: latestUsableRecommendations.length,
      notes: [...notes, "AI analysis is still pending for this run."],
      preference,
      metrics: createRunMetrics(discoveryMetrics, candidates.length, scoredCandidateCount),
      recommendations: latestUsableRecommendations
    });

    const aiCandidateCount = Math.min(scored.length, maxAiCandidates);
    await setStage("ai-analysis", { completed: 0, total: aiCandidateCount });
    const analyzed = await analyzeScoredCandidates(
      scored,
      preference,
      analyzeRepositoryWithFallback,
      (completed, total) => setStage("ai-analysis", { completed, total }),
      maxAiCandidates
    );
    await stageUpdateQueue;
    notes.push(...analyzed.notes);

    const finishedAt = new Date();
    const usedFallback =
      source !== "github" ||
      analyzed.providerErrorFallbackCount > 0 ||
      analyzed.missingProviderFallbackCount > 0;
    const status: RadarRun["status"] = usedFallback ? "partial" : "success";
    const run: RadarRun = {
      runId,
      date: toDateKey(startedAt),
      source,
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      rawCandidateCount: candidates.length,
      recommendationCount: analyzed.recommendations.length,
      notes,
      preference,
      metrics: createRunMetrics(discoveryMetrics, candidates.length, scoredCandidateCount, analyzed.metrics, analyzed.ruleOnlyCount),
      recommendations: analyzed.recommendations
    };

    await setStage("save-final-run");
    return saveRadarRun(run);
  } catch (error) {
    const failedStage = stage;
    const fallbackRecommendations =
      latestUsableRecommendations.length > 0 ? latestUsableRecommendations : getRecommendations(preference);
    const finishedAt = new Date();
    const run: RadarRun = {
      runId,
      date: toDateKey(startedAt),
      source: latestUsableRecommendations.length > 0 ? source : "seed",
      status: "partial",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      rawCandidateCount: candidates.length,
      recommendationCount: fallbackRecommendations.length,
      notes: [...notes, `Pipeline failed during ${failedStage}: ${summarizeError(error)}`],
      preference,
      metrics: createRunMetrics(discoveryMetrics, candidates.length, scoredCandidateCount),
      recommendations: fallbackRecommendations
    };

    await setStage("save-fallback-run");
    return saveRadarRun(run);
  }
}

export async function analyzeScoredCandidates(
  scored: ScoredCandidate[],
  preference: Awaited<ReturnType<typeof getUserPreference>>,
  analyze: AnalyzeFn = analyzeRepositoryWithFallback,
  onProgress?: (completed: number, total: number) => void,
  analysisLimit = scored.length
) {
  const safeAnalysisLimit = Math.max(0, Math.min(scored.length, Math.round(analysisLimit)));
  const aiScored = scored.slice(0, safeAnalysisLimit);
  const results: RepositoryAnalysisResult[] = scored.map((item) => ({
    analysis: createRuleBasedAnalysis(item.repo, item.score, preference),
    source: "rule",
    providerAttempts: []
  }));
  const concurrency = Math.min(aiScored.length, readBoundedInteger(process.env.RADAR_AI_CONCURRENCY, 3, 1, 6));
  let completed = 0;
  let circuitBreakerTriggered = false;

  for (let batchStart = 0; batchStart < aiScored.length; batchStart += concurrency) {
    const batch = aiScored.slice(batchStart, batchStart + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (item): Promise<RepositoryAnalysisResult> => {
        try {
          return await analyze(item.repo, item.score, preference);
        } catch (error) {
          const classified = classifyOperationalError(error, { system: "ai" });
          return {
            analysis: createRuleBasedAnalysis(item.repo, item.score, preference),
            source: "rule",
            fallbackReason: "provider-error",
            errorSummary: `Unhandled analyzer failure: ${classified.summary}`,
            errorCategory: classified.category,
            retryable: classified.retryable,
            providerAttempts: []
          };
        }
      })
    );

    for (const [batchIndex, result] of batchResults.entries()) {
      results[batchStart + batchIndex] = result;
    }
    completed += batchResults.length;
    onProgress?.(completed, aiScored.length);

    const sharedFallbackReason = getSharedFallbackReason(batchResults);
    const remainingStart = batchStart + batchResults.length;
    if (sharedFallbackReason && remainingStart < aiScored.length) {
      circuitBreakerTriggered = true;

      for (let index = remainingStart; index < aiScored.length; index += 1) {
        const item = aiScored[index];
        results[index] = {
          analysis: createRuleBasedAnalysis(item.repo, item.score, preference),
          source: "rule",
          fallbackReason: sharedFallbackReason,
          errorSummary:
            sharedFallbackReason === "provider-error"
              ? "Skipped after the AI provider failed for a complete batch."
              : undefined,
          providerAttempts: []
        };
      }

      completed = aiScored.length;
      onProgress?.(completed, aiScored.length);
      break;
    }
  }

  const recommendations: RadarRecommendation[] = [];
  const aiFallbacks: string[] = [];
  let missingProviderFallbackCount = 0;

  for (const [index, item] of scored.entries()) {
    const result = results[index];

    if (result.fallbackReason === "not-configured") {
      missingProviderFallbackCount += 1;
    }

    if (result.fallbackReason === "provider-error") {
      aiFallbacks.push(`${item.repo.fullName}: ${result.errorSummary ?? "unknown error"}`);
    }

    recommendations.push({
      repo: item.repo,
      score: item.score,
      analysis: result.analysis,
      rank: index + 1,
      analysisTrace: {
        source: result.source,
        fallbackReason: result.fallbackReason,
        providerAttempts: result.providerAttempts
      }
    });
  }

  const notes: string[] = [];

  if (missingProviderFallbackCount > 0) {
    notes.push(`DeepSeek is not configured; used fallback analysis for ${missingProviderFallbackCount} repositories.`);
  }

  if (aiFallbacks.length > 0) {
    notes.push(`DeepSeek fallback used for ${aiFallbacks.length} repositories after provider errors.`);
    notes.push(`DeepSeek fallback reasons: ${aiFallbacks.slice(0, 4).join(" | ")}`);
  }

  if (circuitBreakerTriggered) {
    notes.push("DeepSeek circuit breaker stopped additional calls after a complete batch used fallback.");
  }

  const ruleOnlyCount = scored.length - safeAnalysisLimit;
  if (ruleOnlyCount > 0) {
    notes.push(
      `Limited AI analysis to the top ${safeAnalysisLimit} repositories; used rule-based analysis for ${ruleOnlyCount} lower-ranked recommendations.`
    );
  }

  const usage = results.reduce(
    (total, result) => ({
      inputTokens: total.inputTokens + (result.usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (result.usage?.outputTokens ?? 0),
      totalTokens: total.totalTokens + (result.usage?.totalTokens ?? 0)
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );
  const aiSuccessCount = results.slice(0, safeAnalysisLimit).filter((result) => result.source === "ai").length;

  return {
    recommendations,
    notes,
    missingProviderFallbackCount,
    providerErrorFallbackCount: aiFallbacks.length,
    ruleOnlyCount,
    metrics: {
      aiRequestedCount: safeAnalysisLimit,
      aiSuccessCount,
      aiFallbackCount: safeAnalysisLimit - aiSuccessCount,
      ...usage
    }
  };
}

function getSharedFallbackReason(results: RepositoryAnalysisResult[]) {
  if (results.length === 0) return null;
  if (results.every((result) => result.fallbackReason === "not-configured")) return "not-configured" as const;
  if (results.every((result) => result.fallbackReason === "provider-error")) return "provider-error" as const;
  return null;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createRunMetrics(
  discovery: { queryCount: number; failedQueryCount: number },
  discoveredCandidateCount: number,
  scoredCandidateCount: number,
  ai: {
    aiRequestedCount: number;
    aiSuccessCount: number;
    aiFallbackCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } = {
    aiRequestedCount: 0,
    aiSuccessCount: 0,
    aiFallbackCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  },
  ruleOnlyCount = scoredCandidateCount
) {
  return {
    discoveryQueryCount: discovery.queryCount,
    discoveryFailureCount: discovery.failedQueryCount,
    discoveredCandidateCount,
    scoredCandidateCount,
    aiRequestedCount: ai.aiRequestedCount,
    aiSuccessCount: ai.aiSuccessCount,
    aiFallbackCount: ai.aiFallbackCount,
    ruleOnlyCount,
    inputTokens: ai.inputTokens,
    outputTokens: ai.outputTokens,
    totalTokens: ai.totalTokens
  };
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function summarizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:ghp_|github_pat_|sk-)[A-Za-z0-9_\-]+/g, "[redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url-redacted]")
    .slice(0, 220);
}
