import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuleBasedDetailedStudyPlan } from "../lib/ai/detailed-study-plan";
import { closeSqlClient, getSqlClient } from "../lib/db/client";
import { cleanupExpiredAnonymousUserData } from "../lib/user-data";
import { getOrCreateDetailedStudyPlan } from "../lib/detailed-study-plans";
import { claimNextJobRun, createOrReuseJobRun, finishJobRun } from "../lib/job-runs";
import { saveRadarRun } from "../lib/radar-runs";
import { getRepositoryCandidate } from "../lib/repository-store";
import { defaultPreference, seedRepos } from "../lib/seed-data";
import type { RadarRecommendation, RadarRun } from "../lib/types";
import { loadLocalEnv } from "./load-local-env";
import { assertPostgresIntegrationTarget } from "./postgres-integration-safety";
import {
  calculateMigrationChecksum,
  migrationAdvisoryLockName
} from "./migration-integrity";

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
  const expiredSessionId = `anon_${createHash("sha256").update(`expired-${suffix}`).digest("hex")}`;
  const renewedSessionId = `anon_${createHash("sha256").update(`renewed-${suffix}`).digest("hex")}`;
  const legacySessionId = `legacy-integration-${suffix}`;
  let planId: string | null = null;
  let schemaReady = false;

  try {
    const migrationRows = await sql`
      SELECT version, checksum FROM schema_migrations
      WHERE version = '0014_study_plan_job_serialization.sql'
      LIMIT 1
    `;
    assert.equal(migrationRows.length, 1, "Run pnpm db:migrate before the PostgreSQL integration test.");
    const migrationContents = await fs.readFile(
      path.join(process.cwd(), "migrations", "0014_study_plan_job_serialization.sql"),
      "utf8"
    );
    assert.equal(
      String(migrationRows[0].checksum),
      calculateMigrationChecksum(migrationContents),
      "Applied migration checksum does not match the repository migration."
    );
    schemaReady = true;

    const reserved = await sql.reserve();
    await reserved`SELECT pg_advisory_lock(hashtext(${migrationAdvisoryLockName}))`;
    try {
      const lockAttempt = await sql`
        SELECT pg_try_advisory_lock(hashtext(${migrationAdvisoryLockName})) AS acquired
      `;
      if (lockAttempt[0]?.acquired === true) {
        await sql`SELECT pg_advisory_unlock(hashtext(${migrationAdvisoryLockName}))`;
      }
      assert.equal(lockAttempt[0]?.acquired, false, "Migration advisory lock did not serialize competing sessions.");
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${migrationAdvisoryLockName}))`;
      reserved.release();
    }

    const sessionCutoff = new Date();
    const expiredAt = new Date(sessionCutoff.getTime() - 60_000).toISOString();
    const renewedUntil = new Date(sessionCutoff.getTime() + 60 * 60_000).toISOString();
    await sql`
      INSERT INTO anonymous_sessions (user_id, created_at, last_seen_at, expires_at)
      VALUES
        (${expiredSessionId}, ${expiredAt}, ${expiredAt}, ${expiredAt}),
        (${renewedSessionId}, ${expiredAt}, ${expiredAt}, ${expiredAt}),
        (${legacySessionId}, ${expiredAt}, ${expiredAt}, ${expiredAt})
    `;
    await sql`
      INSERT INTO learning_progress (user_id, plan_id, step_id, completed, client_updated_at)
      VALUES (${expiredSessionId}, ${`integration-expired-${suffix}`}, 'step-1', TRUE, ${expiredAt})
    `;
    await sql`
      INSERT INTO user_preferences (user_id, interests, languages, level, goal, updated_at)
      VALUES (${expiredSessionId}, '[]'::jsonb, '[]'::jsonb, 'intermediate', 'clone', ${expiredAt})
    `;
    await sql`
      INSERT INTO repo_interactions (user_id, repo_id, bookmarked, updated_at)
      VALUES (${expiredSessionId}, 42, TRUE, ${expiredAt})
    `;
    await sql`
      INSERT INTO feedback_events (event_id, user_id, repo_id, event_type, value, payload, created_at)
      VALUES (${`integration-feedback-${suffix}`}, ${expiredSessionId}, 42, 'bookmarked', TRUE, '{}'::jsonb, ${expiredAt})
    `;

    let signalLocked: () => void = () => undefined;
    let releaseLock: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const renewal = sql.begin(async (transaction) => {
      await transaction`SELECT user_id FROM anonymous_sessions WHERE user_id = ${renewedSessionId} FOR UPDATE`;
      signalLocked();
      await release;
      await transaction`
        UPDATE anonymous_sessions
        SET last_seen_at = ${sessionCutoff.toISOString()}, expires_at = ${renewedUntil}
        WHERE user_id = ${renewedSessionId}
      `;
    });
    await locked;
    let cleanup: Awaited<ReturnType<typeof cleanupExpiredAnonymousUserData>>;
    try {
      cleanup = await cleanupExpiredAnonymousUserData(sessionCutoff, 100, 1);
    } finally {
      releaseLock();
    }
    await renewal;
    assert.equal(cleanup.storage, "postgres");
    assert.equal(cleanup.deletedUserIds.includes(expiredSessionId), true);
    assert.equal(cleanup.deletedUserIds.includes(renewedSessionId), false);
    const sessionRows = await sql`
      SELECT user_id FROM anonymous_sessions
      WHERE user_id IN (${renewedSessionId}, ${legacySessionId})
      ORDER BY user_id
    `;
    assert.deepEqual(new Set(sessionRows.map((row) => String(row.user_id))), new Set([renewedSessionId, legacySessionId]));
    const childCounts = await sql`
      SELECT
        (SELECT COUNT(*) FROM learning_progress WHERE user_id = ${expiredSessionId}) AS progress_count,
        (SELECT COUNT(*) FROM user_preferences WHERE user_id = ${expiredSessionId}) AS preference_count,
        (SELECT COUNT(*) FROM repo_interactions WHERE user_id = ${expiredSessionId}) AS interaction_count,
        (SELECT COUNT(*) FROM feedback_events WHERE user_id = ${expiredSessionId}) AS feedback_count
    `;
    assert.equal(Number(childCounts[0].progress_count), 0);
    assert.equal(Number(childCounts[0].preference_count), 0);
    assert.equal(Number(childCounts[0].interaction_count), 0);
    assert.equal(Number(childCounts[0].feedback_count), 0);

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
        await transaction`
          DELETE FROM anonymous_sessions
          WHERE user_id IN (${expiredSessionId}, ${renewedSessionId}, ${legacySessionId})
        `;
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
