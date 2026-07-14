import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuleBasedDetailedStudyPlan } from "../lib/ai/detailed-study-plan";
import { closeSqlClient, getSqlClient } from "../lib/db/client";
import { getOrCreateDetailedStudyPlan } from "../lib/detailed-study-plans";
import { claimNextJobRun, createOrReuseJobRun, finishJobRun } from "../lib/job-runs";
import { saveRadarRun } from "../lib/radar-runs";
import { getRepositoryCandidate } from "../lib/repository-store";
import { defaultPreference, seedRepos } from "../lib/seed-data";
import type { RadarRecommendation, RadarRun } from "../lib/types";
import { loadLocalEnv } from "./load-local-env";
import { assertPostgresIntegrationTarget } from "./postgres-integration-safety";

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  loadLocalEnv(".env.local");
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main() {
  assertPostgresIntegrationTarget(process.env.DATABASE_URL, process.env.ALLOW_POSTGRES_INTEGRATION_TEST);
  const sql = getSqlClient();
  if (!sql) throw new Error("PostgreSQL client is unavailable.");
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const githubId = 7_000_000_000_000 + (Date.now() % 1_000_000_000) + Math.floor(Math.random() * 1_000);
  const runId = `integration-radar-${suffix}`;
  const jobRunId = `integration-job-${suffix}`;
  const jobName = `integration-job-${suffix}`;
  let planId: string | null = null;
  let schemaReady = false;

  try {
    const migrationRows = await sql`
      SELECT version FROM schema_migrations
      WHERE version = '0014_study_plan_job_serialization.sql'
      LIMIT 1
    `;
    assert.equal(migrationRows.length, 1, "Run pnpm db:migrate before the PostgreSQL integration test.");
    schemaReady = true;

    const baseRepo = seedRepos[0];
    const repository = {
      ...baseRepo,
      id: githubId,
      owner: "integration-test",
      name: `radar-${suffix}`,
      fullName: `integration-test/radar-${suffix}`,
      url: `https://github.com/integration-test/radar-${suffix}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pushedAt: new Date().toISOString()
    };
    const score = { ...createScoreFixture(githubId), repoId: githubId };
    const analysis = { ...createAnalysisFixture(githubId), repoId: githubId };
    const recommendation: RadarRecommendation = {
      repo: repository,
      score,
      analysis,
      rank: 1,
      analysisTrace: { source: "rule", providerAttempts: [] }
    };
    const run: RadarRun = {
      runId,
      date: new Date().toISOString().slice(0, 10),
      source: "github",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      rawCandidateCount: 1,
      recommendationCount: 1,
      notes: ["PostgreSQL integration fixture"],
      preference: defaultPreference,
      recommendations: [recommendation]
    };

    await saveRadarRun(run);
    const projectionRows = await sql`
      SELECT
        repositories.id AS repository_id,
        (SELECT COUNT(*) FROM radar_runs WHERE run_id = ${runId}) AS radar_count,
        (SELECT COUNT(*) FROM repo_scores WHERE run_id = ${runId}) AS score_count,
        (SELECT COUNT(*) FROM repo_analyses WHERE run_id = ${runId}) AS analysis_count,
        (SELECT COUNT(*) FROM recommendations WHERE run_id = ${runId}) AS recommendation_count
      FROM repositories
      WHERE github_id = ${githubId}
    `;
    assert.equal(projectionRows.length, 1);
    assert.equal(Number(projectionRows[0].radar_count), 1);
    assert.equal(Number(projectionRows[0].score_count), 1);
    assert.equal(Number(projectionRows[0].analysis_count), 1);
    assert.equal(Number(projectionRows[0].recommendation_count), 1);
    const repositoryId = Number(projectionRows[0].repository_id);
    const internalIds = await sql`
      SELECT repo_id FROM repo_scores WHERE run_id = ${runId}
      UNION ALL SELECT repo_id FROM repo_analyses WHERE run_id = ${runId}
      UNION ALL SELECT repo_id FROM recommendations WHERE run_id = ${runId}
    `;
    assert.ok(internalIds.every((row) => Number(row.repo_id) === repositoryId));
    assert.notEqual(repositoryId, githubId);
    const storedCandidate = await getRepositoryCandidate(repository.owner, repository.name);
    assert.equal(storedCandidate?.id, githubId);

    const planResult = await getOrCreateDetailedStudyPlan(recommendation, 3, {
      preference: defaultPreference,
      generate: async (item, duration, context) => createRuleBasedDetailedStudyPlan(item, duration, context)
    });
    planId = planResult.plan.id;
    assert.equal(planResult.cached, false);
    const cachedPlan = await getOrCreateDetailedStudyPlan(recommendation, 3, {
      preference: defaultPreference,
      generate: async () => {
        throw new Error("Cached PostgreSQL plan unexpectedly regenerated.");
      }
    });
    assert.equal(cachedPlan.cached, true);
    assert.equal(cachedPlan.plan.id, planId);

    const createdJob = await createOrReuseJobRun({
      runId: jobRunId,
      idempotencyKey: `integration:${suffix}`,
      jobName,
      maxAttempts: 2
    });
    assert.equal(createdJob.created, true);
    const claims = await Promise.all([
      claimNextJobRun(jobName, "integration-test"),
      claimNextJobRun(jobName, "integration-test")
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(claims.find(Boolean)?.runId, jobRunId);
    assert.equal((await finishJobRun(jobRunId, { status: "success" }))?.status, "success");

    console.log("PostgreSQL integration passed: migrations, radar transaction, projections, cache, and atomic job claim.");
  } finally {
    try {
      if (schemaReady) await sql.begin(async (transaction) => {
        if (planId) {
          await transaction`DELETE FROM learning_progress WHERE plan_id = ${`detailed:${planId}`}`;
        }
        await transaction`DELETE FROM detailed_study_plans WHERE repo_id = ${githubId}`;
        await transaction`DELETE FROM recommendations WHERE run_id = ${runId}`;
        await transaction`DELETE FROM repo_analyses WHERE run_id = ${runId}`;
        await transaction`DELETE FROM repo_scores WHERE run_id = ${runId}`;
        await transaction`DELETE FROM radar_run_archives WHERE run_id = ${runId}`;
        await transaction`DELETE FROM radar_runs WHERE run_id = ${runId}`;
        await transaction`DELETE FROM job_runs WHERE run_id = ${jobRunId}`;
        const repositoryRows = await transaction`SELECT id FROM repositories WHERE github_id = ${githubId}`;
        const repositoryIds = repositoryRows.map((row) => Number(row.id));
        if (repositoryIds.length > 0) {
          await transaction`DELETE FROM repository_snapshots WHERE repo_id = ANY(${repositoryIds}::int[])`;
          await transaction`DELETE FROM repositories WHERE id = ANY(${repositoryIds}::int[])`;
        }
      });
    } finally {
      await closeSqlClient();
    }
  }
}

function createScoreFixture(repoId: number): RadarRecommendation["score"] {
  return {
    repoId,
    trendScore: 70,
    learningValueScore: 80,
    cloneabilityScore: 75,
    repoHealthScore: 78,
    userMatchScore: 82,
    finalScore: 77,
    reasons: ["PostgreSQL integration score"],
    risks: ["Integration fixture only"]
  };
}

function createAnalysisFixture(repoId: number): RadarRecommendation["analysis"] {
  return {
    repoId,
    projectType: "Integration test",
    oneLineSummary: "Temporary PostgreSQL integration fixture.",
    learningTags: ["PostgreSQL", "integration"],
    difficulty: "intermediate",
    whyLearn: ["验证事务投影", "验证缓存"],
    miniCloneScope: {
      goal: "验证数据库写入边界",
      coreFeatures: ["事务快照", "规范化投影"],
      excludedFeatures: ["真实 GitHub 调用"]
    },
    recommendedFor: ["维护者"],
    notRecommendedFor: ["生产业务数据"],
    risks: ["只允许在显式确认的测试数据库运行"],
    confidence: 1,
    learningPlan: {
      plan3Days: createPlanDays(3),
      plan7Days: createPlanDays(7),
      plan14Days: createPlanDays(14)
    }
  };
}

function createPlanDays(length: number) {
  return Array.from({ length }, (_, index) => ({
    day: index + 1,
    goal: "数据库集成验证",
    tasks: ["写入测试数据", "验证并清理"],
    deliverable: "无残留的验证报告"
  }));
}
