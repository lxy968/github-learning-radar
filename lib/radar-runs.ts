import { promises as fs } from "fs";
import path from "path";
import { getSqlClient } from "@/lib/db/client";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { normalizeEnrichmentSignals } from "@/lib/repository-signals";
import { createRadarRunProjection } from "@/lib/radar-run-projection";
import type { RadarRun, UserPreference } from "@/lib/types";

type RadarRunStore = {
  runs: RadarRun[];
};

const dataDir = path.join(process.cwd(), ".data");

export async function getLatestRadarRun() {
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT * FROM radar_runs
      ORDER BY finished_at DESC
      LIMIT 1
    `;

    return rows[0] ? mapRadarRunRow(rows[0]) : null;
  }

  const store = await readStore();
  const latestRun = store.runs[store.runs.length - 1];
  return latestRun ? normalizeRadarRun(latestRun) : null;
}

export async function listRadarRuns(limit = 10) {
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT * FROM radar_runs
      ORDER BY finished_at DESC
      LIMIT ${limit}
    `;

    return rows.map(mapRadarRunRow);
  }

  const store = await readStore();
  return store.runs.slice(-limit).reverse().map(normalizeRadarRun);
}

export async function saveRadarRun(run: RadarRun) {
  const normalizedRun = normalizeRadarRun(run);
  const sql = getSqlClient();

  if (sql) {
    const projection = createRadarRunProjection(normalizedRun);
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO radar_runs (
          run_id,
          run_date,
          source,
          status,
          started_at,
          finished_at,
          raw_candidate_count,
          recommendation_count,
          notes,
          preference_snapshot,
          metrics,
          recommendations
        )
        VALUES (
          ${normalizedRun.runId},
          ${normalizedRun.date},
          ${normalizedRun.source},
          ${normalizedRun.status},
          ${normalizedRun.startedAt},
          ${normalizedRun.finishedAt},
          ${normalizedRun.rawCandidateCount},
          ${normalizedRun.recommendationCount},
          ${transaction.json(normalizedRun.notes as never)},
          ${transaction.json((normalizedRun.preference ?? {}) as never)},
          ${transaction.json((normalizedRun.metrics ?? {}) as never)},
          ${transaction.json(normalizedRun.recommendations as never)}
        )
        ON CONFLICT (run_id) DO UPDATE SET
          run_date = EXCLUDED.run_date,
          source = EXCLUDED.source,
          status = EXCLUDED.status,
          started_at = EXCLUDED.started_at,
          finished_at = EXCLUDED.finished_at,
          raw_candidate_count = EXCLUDED.raw_candidate_count,
          recommendation_count = EXCLUDED.recommendation_count,
          notes = EXCLUDED.notes,
          preference_snapshot = EXCLUDED.preference_snapshot,
          metrics = EXCLUDED.metrics,
          recommendations = EXCLUDED.recommendations
      `;

      await transaction`DELETE FROM recommendations WHERE run_id = ${normalizedRun.runId}`;
      await transaction`DELETE FROM repo_analyses WHERE run_id = ${normalizedRun.runId}`;
      await transaction`DELETE FROM repo_scores WHERE run_id = ${normalizedRun.runId}`;

      for (const [index, recommendation] of normalizedRun.recommendations.entries()) {
        const repo = recommendation.repo;
        const repositoryRows = await transaction`
          INSERT INTO repositories (
            github_id,
            full_name,
            owner_login,
            name,
            html_url,
            description,
            homepage,
            category,
            primary_language,
            license_spdx,
            topics,
            languages,
            readme_excerpt,
            detected_files,
            has_tests,
            has_examples,
            has_ci,
            has_docker,
            enrichment_signals,
            dependencies,
            size_kb,
            pushed_at,
            created_at,
            updated_at
          )
          VALUES (
            ${repo.id},
            ${repo.fullName},
            ${repo.owner},
            ${repo.name},
            ${repo.url},
            ${repo.description},
            ${repo.homepage ?? null},
            ${repo.category},
            ${repo.primaryLanguage},
            ${repo.license},
            ${transaction.json(repo.topics as never)},
            ${transaction.json(repo.languages as never)},
            ${repo.readmeExcerpt},
            ${transaction.json(repo.detectedFiles as never)},
            ${repo.hasTests},
            ${repo.hasExamples},
            ${repo.hasCi},
            ${repo.hasDocker},
            ${transaction.json((repo.enrichment ?? {}) as never)},
            ${transaction.json(repo.dependencies as never)},
            ${repo.sizeKb},
            ${repo.pushedAt},
            ${repo.createdAt},
            ${repo.updatedAt}
          )
          ON CONFLICT (github_id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            owner_login = EXCLUDED.owner_login,
            name = EXCLUDED.name,
            html_url = EXCLUDED.html_url,
            description = EXCLUDED.description,
            homepage = EXCLUDED.homepage,
            category = EXCLUDED.category,
            primary_language = EXCLUDED.primary_language,
            license_spdx = EXCLUDED.license_spdx,
            topics = EXCLUDED.topics,
            languages = EXCLUDED.languages,
            readme_excerpt = EXCLUDED.readme_excerpt,
            detected_files = EXCLUDED.detected_files,
            has_tests = EXCLUDED.has_tests,
            has_examples = EXCLUDED.has_examples,
            has_ci = EXCLUDED.has_ci,
            has_docker = EXCLUDED.has_docker,
            enrichment_signals = EXCLUDED.enrichment_signals,
            dependencies = EXCLUDED.dependencies,
            size_kb = EXCLUDED.size_kb,
            pushed_at = EXCLUDED.pushed_at,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
          RETURNING id
        `;
        const repositoryId = Number(repositoryRows[0].id);
        const score = projection.scores[index];
        const analysis = projection.analyses[index];
        const projectedRecommendation = projection.recommendations[index];

        await transaction`
          INSERT INTO repo_scores (
            repo_id, run_id, trend_score, learning_value_score, cloneability_score,
            repo_health_score, user_match_score, final_score, reasons, risks
          )
          VALUES (
            ${repositoryId}, ${score.runId}, ${score.trendScore}, ${score.learningValueScore},
            ${score.cloneabilityScore}, ${score.repoHealthScore}, ${score.userMatchScore},
            ${score.finalScore}, ${transaction.json(score.reasons as never)}, ${transaction.json(score.risks as never)}
          )
        `;
        await transaction`
          INSERT INTO repo_analyses (
            repo_id, run_id, prompt_version, schema_version, input_hash, model, source,
            fallback_reason, provider_attempts, analysis, confidence
          )
          VALUES (
            ${repositoryId}, ${analysis.runId}, ${analysis.promptVersion}, ${analysis.schemaVersion},
            ${analysis.inputHash}, ${analysis.model}, ${analysis.source}, ${analysis.fallbackReason ?? null},
            ${transaction.json(analysis.providerAttempts as never)},
            ${transaction.json(analysis.analysis as never)}, ${analysis.confidence}
          )
        `;
        await transaction`
          INSERT INTO recommendations (
            user_id, repo_id, run_id, recommendation_date, rank, score, reason, analysis_source
          )
          VALUES (
            ${projectedRecommendation.userId}, ${repositoryId}, ${projectedRecommendation.runId},
            ${projectedRecommendation.recommendationDate}, ${projectedRecommendation.rank},
            ${projectedRecommendation.score}, ${projectedRecommendation.reason},
            ${projectedRecommendation.analysisSource}
          )
        `;
      }
    });

    return normalizedRun;
  }

  const store = await readStore();
  const withoutDuplicate = store.runs.filter((item) => item.runId !== normalizedRun.runId);
  const nextRuns = [...withoutDuplicate, normalizedRun].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  await writeStore({ runs: nextRuns });
  return normalizedRun;
}

export async function rebuildRadarRunProjections() {
  const sql = getSqlClient();
  if (!sql) return { status: "skipped" as const, rebuiltRunCount: 0, projectedRecommendationCount: 0 };
  const rows = await sql`
    SELECT * FROM radar_runs
    ORDER BY finished_at ASC
  `;
  let projectedRecommendationCount = 0;

  for (const row of rows) {
    const run = mapRadarRunRow(row);
    await saveRadarRun(run);
    projectedRecommendationCount += run.recommendations.length;
  }

  return {
    status: "rebuilt" as const,
    rebuiltRunCount: rows.length,
    projectedRecommendationCount
  };
}

function mapRadarRunRow(row: Record<string, unknown>): RadarRun {
  return normalizeRadarRun({
    runId: String(row.run_id),
    date: String(row.run_date),
    source: row.source === "github" ? "github" : "seed",
    status: row.status === "failed" ? "failed" : row.status === "partial" ? "partial" : "success",
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
    rawCandidateCount: Number(row.raw_candidate_count),
    recommendationCount: Number(row.recommendation_count),
    notes: Array.isArray(row.notes) ? (row.notes as string[]) : [],
    preference: normalizePreferenceSnapshot(row.preference_snapshot),
    metrics: normalizeMetrics(row.metrics),
    recommendations: Array.isArray(row.recommendations) ? (row.recommendations as RadarRun["recommendations"]) : []
  });
}

function normalizeRadarRun(run: RadarRun): RadarRun {
  const recommendations = run.recommendations.map((recommendation) => ({
    ...recommendation,
    analysisTrace: normalizeAnalysisTrace(recommendation.analysisTrace),
    repo: normalizeRunRepository({
      ...recommendation.repo,
      readmeExcerpt: sanitizeReadmeExcerpt(recommendation.repo.readmeExcerpt)
    })
  }));
  return {
    ...run,
    recommendationCount: recommendations.length,
    preference: normalizePreferenceSnapshot(run.preference),
    metrics: normalizeMetrics(run.metrics),
    recommendations
  };
}

function normalizePreferenceSnapshot(value: unknown): UserPreference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const interests = Array.isArray(input.interests)
    ? input.interests.filter(
        (item): item is UserPreference["interests"][number] =>
          item === "ai-app" ||
          item === "frontend" ||
          item === "backend" ||
          item === "devtool" ||
          item === "database" ||
          item === "automation" ||
          item === "cli" ||
          item === "fullstack"
      )
    : [];
  const languages = Array.isArray(input.languages)
    ? input.languages.filter((item): item is string => typeof item === "string")
    : [];
  const level = input.level;
  const goal = input.goal;
  const refreshInterval = input.refreshInterval;
  if (
    interests.length === 0 ||
    languages.length === 0 ||
    (level !== "beginner" && level !== "intermediate" && level !== "advanced") ||
    (goal !== "clone" && goal !== "portfolio" && goal !== "trend" && goal !== "source-reading") ||
    (refreshInterval !== "daily" &&
      refreshInterval !== "three-days" &&
      refreshInterval !== "weekly" &&
      refreshInterval !== "monthly" &&
      refreshInterval !== "never")
  ) {
    return undefined;
  }

  return { interests, languages, level, goal, refreshInterval };
}

function normalizeAnalysisTrace(
  trace: RadarRun["recommendations"][number]["analysisTrace"]
): RadarRun["recommendations"][number]["analysisTrace"] {
  if (!trace || typeof trace !== "object") return undefined;
  const source = trace.source === "ai" || trace.source === "seed" ? trace.source : "rule";
  const fallbackReason =
    trace.fallbackReason === "not-configured" || trace.fallbackReason === "provider-error"
      ? trace.fallbackReason
      : undefined;
  const providerAttempts = Array.isArray(trace.providerAttempts)
    ? trace.providerAttempts
        .filter((attempt) => attempt && typeof attempt === "object" && attempt.provider === "deepseek")
        .map((attempt) => ({
          provider: "deepseek" as const,
          modelId: String(attempt.modelId ?? "unknown"),
          status: attempt.status === "success" ? ("success" as const) : ("failed" as const),
          errorSummary: attempt.errorSummary ? String(attempt.errorSummary) : undefined,
          errorCategory: attempt.errorCategory ? String(attempt.errorCategory) : undefined,
          retryable: typeof attempt.retryable === "boolean" ? attempt.retryable : undefined,
          usage: attempt.usage
            ? {
                inputTokens: toCount(attempt.usage.inputTokens),
                outputTokens: toCount(attempt.usage.outputTokens),
                totalTokens: toCount(attempt.usage.totalTokens)
              }
            : undefined
        }))
    : [];

  return { source, fallbackReason, providerAttempts };
}

function normalizeRunRepository(repo: RadarRun["recommendations"][number]["repo"]) {
  return { ...repo, enrichment: normalizeEnrichmentSignals(repo.enrichment, repo) };
}

function normalizeMetrics(value: unknown): RadarRun["metrics"] {
  if (!value || typeof value !== "object") return undefined;
  const metrics = value as Record<string, unknown>;
  return {
    discoveryQueryCount: toCount(metrics.discoveryQueryCount),
    discoveryFailureCount: toCount(metrics.discoveryFailureCount),
    discoveredCandidateCount: toCount(metrics.discoveredCandidateCount),
    scoredCandidateCount: toCount(metrics.scoredCandidateCount),
    aiRequestedCount: toCount(metrics.aiRequestedCount),
    aiSuccessCount: toCount(metrics.aiSuccessCount),
    aiFallbackCount: toCount(metrics.aiFallbackCount),
    ruleOnlyCount: toCount(metrics.ruleOnlyCount),
    inputTokens: toCount(metrics.inputTokens),
    outputTokens: toCount(metrics.outputTokens),
    totalTokens: toCount(metrics.totalTokens)
  };
}

function toCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function readStore(): Promise<RadarRunStore> {
  try {
    const content = await fs.readFile(getRunsFile(), "utf8");
    const parsed = JSON.parse(content) as RadarRunStore;

    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { runs: [] };
    }

    throw error;
  }
}

async function writeStore(store: RadarRunStore) {
  const runsFile = getRunsFile();
  await fs.mkdir(path.dirname(runsFile), { recursive: true });
  await fs.writeFile(runsFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getRunsFile() {
  return process.env.RADAR_RUN_STORE_FILE
    ? path.resolve(process.env.RADAR_RUN_STORE_FILE)
    : path.join(dataDir, "radar-runs.json");
}
