import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { inspectLocalRateLimitRetention } from "@/lib/api-security";
import { getSqlClient } from "@/lib/db/client";
import type { DetailedStudyPlan, JobRun, RadarRun, RepoSnapshot } from "@/lib/types";

export type DataRetentionPolicy = {
  radarRunDays: number;
  minimumRadarRuns: number;
  terminalJobDays: number;
  detailedPlanDays: number;
  repositorySnapshotDays: number;
  staleCandidateDays: number;
  rateLimitDays: number;
};

export type DataRetentionCounts = {
  radarRunsArchived: number;
  terminalJobsDeleted: number;
  detailedPlansDeleted: number;
  repositorySnapshotsDeleted: number;
  staleCandidatesDeleted: number;
  rateLimitBucketsDeleted: number;
};

export type DataRetentionReport = {
  mode: "dry-run" | "apply";
  storage: "postgres" | "local-json";
  referenceTime: string;
  policy: DataRetentionPolicy;
  counts: DataRetentionCounts;
};

const terminalJobStatuses = new Set(["success", "partial", "failed", "cancelled"]);

export function getDataRetentionPolicy(env: NodeJS.ProcessEnv = process.env): DataRetentionPolicy {
  return {
    radarRunDays: boundedInteger(env.RETENTION_RADAR_RUN_DAYS, 180, 7, 3650),
    minimumRadarRuns: boundedInteger(env.RETENTION_MIN_RADAR_RUNS, 20, 1, 500),
    terminalJobDays: boundedInteger(env.RETENTION_JOB_RUN_DAYS, 30, 1, 3650),
    detailedPlanDays: boundedInteger(env.RETENTION_DETAILED_PLAN_DAYS, 365, 30, 3650),
    repositorySnapshotDays: boundedInteger(env.RETENTION_REPOSITORY_SNAPSHOT_DAYS, 400, 14, 3650),
    staleCandidateDays: boundedInteger(env.RETENTION_STALE_CANDIDATE_DAYS, 180, 30, 3650),
    rateLimitDays: boundedInteger(env.RETENTION_RATE_LIMIT_DAYS, 7, 1, 90)
  };
}

export async function runDataRetention(options: {
  apply?: boolean;
  now?: Date;
  policy?: DataRetentionPolicy;
} = {}): Promise<DataRetentionReport> {
  const apply = options.apply === true;
  const now = options.now ?? new Date();
  const policy = options.policy ?? getDataRetentionPolicy();
  const sql = getSqlClient();
  const counts = sql
    ? await runPostgresRetention(sql, policy, now, apply)
    : await runLocalRetention(policy, now, apply);
  return {
    mode: apply ? "apply" : "dry-run",
    storage: sql ? "postgres" : "local-json",
    referenceTime: now.toISOString(),
    policy,
    counts
  };
}

async function runLocalRetention(policy: DataRetentionPolicy, now: Date, apply: boolean) {
  const radarStore = await readJson<{ runs?: RadarRun[] }>(getDataFile("RADAR_RUN_STORE_FILE", "radar-runs.json"), {});
  const jobStore = await readJson<{ jobs?: JobRun[] }>(getDataFile("JOB_RUN_STORE_FILE", "job-runs.json"), {});
  const planStore = await readJson<{ plans?: DetailedStudyPlan[] }>(
    getDataFile("DETAILED_STUDY_PLAN_STORE_FILE", "detailed-study-plans.json"),
    {}
  );
  const repositoryStore = await readJson<{
    repositories?: Record<string, RepoSnapshot>;
    snapshots?: Record<string, Array<{ snapshotDate: string }>>;
  }>(getDataFile("REPOSITORY_STORE_FILE", "repository-store.json"), {});
  const progressStore = await readJson<{
    users?: Record<string, Record<string, unknown>>;
  }>(getDataFile("LEARNING_PROGRESS_STORE_FILE", "learning-progress.json"), {});

  const runs = Array.isArray(radarStore.runs) ? radarStore.runs : [];
  const jobs = Array.isArray(jobStore.jobs) ? jobStore.jobs : [];
  const plans = Array.isArray(planStore.plans) ? planStore.plans : [];
  const repositories = repositoryStore.repositories ?? {};
  const snapshots = repositoryStore.snapshots ?? {};
  const radarCutoff = cutoffDate(now, policy.radarRunDays);
  const jobCutoff = cutoffDate(now, policy.terminalJobDays);
  const planCutoff = cutoffDate(now, policy.detailedPlanDays);
  const snapshotCutoff = cutoffDate(now, policy.repositorySnapshotDays).toISOString().slice(0, 10);
  const candidateCutoff = cutoffDate(now, policy.staleCandidateDays);
  const newestRuns = [...runs].sort((a, b) => dateNumber(b.finishedAt) - dateNumber(a.finishedAt));
  const protectedRunIds = new Set(newestRuns.slice(0, policy.minimumRadarRuns).map((run) => run.runId));
  const archivedRuns = newestRuns.filter(
    (run) => !protectedRunIds.has(run.runId) && isBefore(run.finishedAt, radarCutoff)
  );
  const archivedRunIds = new Set(archivedRuns.map((run) => run.runId));
  const retainedRuns = runs.filter((run) => !archivedRunIds.has(run.runId));
  const expiredJobs = jobs.filter(
    (job) => terminalJobStatuses.has(job.status) && isBefore(job.finishedAt ?? job.updatedAt, jobCutoff)
  );
  const expiredJobIds = new Set(expiredJobs.map((job) => job.runId));
  const protectedPlanIds = collectProgressPlanIds(progressStore.users ?? {});
  const newestPlanIds = collectNewestPlanIds(plans);
  const expiredPlans = plans.filter(
    (plan) =>
      !newestPlanIds.has(plan.id) &&
      !protectedPlanIds.has(`detailed:${plan.id}`) &&
      isBefore(plan.generatedAt, planCutoff)
  );
  const expiredPlanIds = new Set(expiredPlans.map((plan) => plan.id));
  const retainedPlans = plans.filter((plan) => !expiredPlanIds.has(plan.id));
  const protectedRepositoryIds = new Set<number>([
    ...retainedRuns.flatMap((run) => run.recommendations.map((item) => item.repo.id)),
    ...retainedPlans.map((plan) => plan.repoId)
  ]);
  const staleRepositoryKeys = Object.entries(repositories)
    .filter(
      ([, repo]) =>
        !protectedRepositoryIds.has(repo.id) && isBefore(repo.updatedAt || repo.pushedAt || repo.createdAt, candidateCutoff)
    )
    .map(([key]) => key);
  const staleRepositoryKeySet = new Set(staleRepositoryKeys);
  let repositorySnapshotsDeleted = 0;
  const retainedSnapshots: typeof snapshots = {};

  for (const [repositoryKey, entries] of Object.entries(snapshots)) {
    if (staleRepositoryKeySet.has(repositoryKey)) {
      repositorySnapshotsDeleted += entries.length;
      continue;
    }
    const sorted = [...entries].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    const retained = sorted.filter((entry, index) => index === 0 || entry.snapshotDate >= snapshotCutoff);
    repositorySnapshotsDeleted += sorted.length - retained.length;
    retainedSnapshots[repositoryKey] = retained.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }

  const rateLimitBucketsDeleted = inspectLocalRateLimitRetention(
    now.getTime(),
    policy.rateLimitDays * 86_400_000,
    apply
  );
  const counts: DataRetentionCounts = {
    radarRunsArchived: archivedRuns.length,
    terminalJobsDeleted: expiredJobs.length,
    detailedPlansDeleted: expiredPlans.length,
    repositorySnapshotsDeleted,
    staleCandidatesDeleted: staleRepositoryKeys.length,
    rateLimitBucketsDeleted
  };

  if (apply) {
    await appendRadarArchive(archivedRuns);
    await writeJsonAtomically(getDataFile("RADAR_RUN_STORE_FILE", "radar-runs.json"), { runs: retainedRuns });
    await writeJsonAtomically(getDataFile("JOB_RUN_STORE_FILE", "job-runs.json"), {
      jobs: jobs.filter((job) => !expiredJobIds.has(job.runId))
    });
    await writeJsonAtomically(getDataFile("DETAILED_STUDY_PLAN_STORE_FILE", "detailed-study-plans.json"), {
      plans: retainedPlans
    });
    await writeJsonAtomically(getDataFile("REPOSITORY_STORE_FILE", "repository-store.json"), {
      repositories: Object.fromEntries(
        Object.entries(repositories).filter(([key]) => !staleRepositoryKeySet.has(key))
      ),
      snapshots: retainedSnapshots
    });
  }

  return counts;
}

async function runPostgresRetention(
  sql: NonNullable<ReturnType<typeof getSqlClient>>,
  policy: DataRetentionPolicy,
  now: Date,
  apply: boolean
) {
  const cutoffs = {
    radar: cutoffDate(now, policy.radarRunDays).toISOString(),
    jobs: cutoffDate(now, policy.terminalJobDays).toISOString(),
    plans: cutoffDate(now, policy.detailedPlanDays).toISOString(),
    snapshots: cutoffDate(now, policy.repositorySnapshotDays).toISOString().slice(0, 10),
    candidates: cutoffDate(now, policy.staleCandidateDays).toISOString(),
    rates: cutoffDate(now, policy.rateLimitDays).toISOString()
  };
  const preview = await inspectPostgresRetention(sql, policy, cutoffs);
  if (!apply) return preview;

  return sql.begin(async (transaction) => {
    const radarRows = await transaction`
      WITH ranked AS (
        SELECT run_id, ROW_NUMBER() OVER (ORDER BY finished_at DESC, id DESC) AS row_number
        FROM radar_runs
      ), eligible AS (
        SELECT radar_runs.*
        FROM radar_runs
        JOIN ranked USING (run_id)
        WHERE ranked.row_number > ${policy.minimumRadarRuns}
          AND radar_runs.finished_at < ${cutoffs.radar}
      )
      INSERT INTO radar_run_archives (run_id, finished_at, archived_at, run)
      SELECT run_id, finished_at, ${now.toISOString()}, to_jsonb(eligible)
      FROM eligible
      ON CONFLICT (run_id) DO UPDATE SET
        finished_at = EXCLUDED.finished_at,
        archived_at = EXCLUDED.archived_at,
        run = EXCLUDED.run
      RETURNING run_id
    `;
    const runIds = radarRows.map((row) => String(row.run_id));
    if (runIds.length > 0) {
      await transaction`DELETE FROM recommendations WHERE run_id = ANY(${runIds})`;
      await transaction`DELETE FROM repo_analyses WHERE run_id = ANY(${runIds})`;
      await transaction`DELETE FROM repo_scores WHERE run_id = ANY(${runIds})`;
      await transaction`DELETE FROM radar_runs WHERE run_id = ANY(${runIds})`;
    }

    const candidateRows = await transaction`
      SELECT repositories.id
      FROM repositories
      WHERE COALESCE(repositories.updated_at, repositories.pushed_at, repositories.created_at, TO_TIMESTAMP(0)) < ${cutoffs.candidates}
        AND NOT EXISTS (SELECT 1 FROM repo_scores WHERE repo_scores.repo_id = repositories.id)
        AND NOT EXISTS (SELECT 1 FROM repo_analyses WHERE repo_analyses.repo_id = repositories.id)
        AND NOT EXISTS (SELECT 1 FROM recommendations WHERE recommendations.repo_id = repositories.id)
        AND NOT EXISTS (SELECT 1 FROM detailed_study_plans WHERE detailed_study_plans.repo_id = repositories.github_id)
        AND NOT EXISTS (SELECT 1 FROM repo_interactions WHERE repo_interactions.repo_id::bigint = repositories.github_id)
        AND NOT EXISTS (SELECT 1 FROM feedback_events WHERE feedback_events.repo_id::bigint = repositories.github_id)
    `;
    const candidateIds = candidateRows.map((row) => Number(row.id));
    const snapshotRows = await transaction`
      WITH ranked AS (
        SELECT id, repo_id, snapshot_date,
          ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY snapshot_date DESC, id DESC) AS row_number
        FROM repository_snapshots
      )
      DELETE FROM repository_snapshots
      WHERE repo_id = ANY(${candidateIds}::int[])
         OR id IN (
           SELECT id FROM ranked
           WHERE row_number > 1 AND snapshot_date < ${cutoffs.snapshots}
         )
      RETURNING id
    `;
    if (candidateIds.length > 0) {
      await transaction`DELETE FROM repositories WHERE id = ANY(${candidateIds}::int[])`;
    }
    const jobRows = await transaction`
      DELETE FROM job_runs
      WHERE status IN ('success', 'partial', 'failed', 'cancelled')
        AND COALESCE(finished_at, updated_at) < ${cutoffs.jobs}
      RETURNING run_id
    `;
    const planRows = await transaction`
      WITH ranked AS (
        SELECT plan_id, generated_at,
          ROW_NUMBER() OVER (
            PARTITION BY repo_id, duration, preference_level, preference_goal
            ORDER BY generated_at DESC, plan_id DESC
          ) AS row_number
        FROM detailed_study_plans
      )
      DELETE FROM detailed_study_plans
      WHERE plan_id IN (
        SELECT plan_id FROM ranked
        WHERE row_number > 1
          AND generated_at < ${cutoffs.plans}
          AND NOT EXISTS (
            SELECT 1 FROM learning_progress
            WHERE learning_progress.plan_id = 'detailed:' || ranked.plan_id
          )
      )
      RETURNING plan_id
    `;
    const rateRows = await transaction`
      DELETE FROM api_rate_limits
      WHERE updated_at < ${cutoffs.rates}
      RETURNING rate_key
    `;

    return {
      radarRunsArchived: radarRows.length,
      terminalJobsDeleted: jobRows.length,
      detailedPlansDeleted: planRows.length,
      repositorySnapshotsDeleted: snapshotRows.length,
      staleCandidatesDeleted: candidateRows.length,
      rateLimitBucketsDeleted: rateRows.length
    };
  });
}

async function inspectPostgresRetention(
  sql: NonNullable<ReturnType<typeof getSqlClient>>,
  policy: DataRetentionPolicy,
  cutoffs: { radar: string; jobs: string; plans: string; snapshots: string; candidates: string; rates: string }
) {
  const rows = await sql`
    WITH ranked_runs AS (
      SELECT run_id, finished_at, ROW_NUMBER() OVER (ORDER BY finished_at DESC, id DESC) AS row_number
      FROM radar_runs
    ), stale_candidates AS (
      SELECT repositories.id
      FROM repositories
      WHERE COALESCE(repositories.updated_at, repositories.pushed_at, repositories.created_at, TO_TIMESTAMP(0)) < ${cutoffs.candidates}
        AND NOT EXISTS (SELECT 1 FROM repo_scores WHERE repo_scores.repo_id = repositories.id)
        AND NOT EXISTS (SELECT 1 FROM repo_analyses WHERE repo_analyses.repo_id = repositories.id)
        AND NOT EXISTS (SELECT 1 FROM recommendations WHERE recommendations.repo_id = repositories.id)
        AND NOT EXISTS (SELECT 1 FROM detailed_study_plans WHERE detailed_study_plans.repo_id = repositories.github_id)
        AND NOT EXISTS (SELECT 1 FROM repo_interactions WHERE repo_interactions.repo_id::bigint = repositories.github_id)
        AND NOT EXISTS (SELECT 1 FROM feedback_events WHERE feedback_events.repo_id::bigint = repositories.github_id)
    ), ranked_snapshots AS (
      SELECT id, repo_id, snapshot_date,
        ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY snapshot_date DESC, id DESC) AS row_number
      FROM repository_snapshots
    ), ranked_plans AS (
      SELECT plan_id, generated_at,
        ROW_NUMBER() OVER (
          PARTITION BY repo_id, duration, preference_level, preference_goal
          ORDER BY generated_at DESC, plan_id DESC
        ) AS row_number
      FROM detailed_study_plans
    )
    SELECT
      (SELECT COUNT(*) FROM ranked_runs WHERE row_number > ${policy.minimumRadarRuns} AND finished_at < ${cutoffs.radar}) AS radar_runs,
      (SELECT COUNT(*) FROM job_runs WHERE status IN ('success', 'partial', 'failed', 'cancelled') AND COALESCE(finished_at, updated_at) < ${cutoffs.jobs}) AS jobs,
      (SELECT COUNT(*) FROM ranked_plans WHERE row_number > 1 AND generated_at < ${cutoffs.plans} AND NOT EXISTS (SELECT 1 FROM learning_progress WHERE learning_progress.plan_id = 'detailed:' || ranked_plans.plan_id)) AS plans,
      (SELECT COUNT(*) FROM ranked_snapshots WHERE repo_id IN (SELECT id FROM stale_candidates) OR (row_number > 1 AND snapshot_date < ${cutoffs.snapshots})) AS snapshots,
      (SELECT COUNT(*) FROM stale_candidates) AS candidates,
      (SELECT COUNT(*) FROM api_rate_limits WHERE updated_at < ${cutoffs.rates}) AS rates
  `;
  const row = rows[0] ?? {};
  return {
    radarRunsArchived: count(row.radar_runs),
    terminalJobsDeleted: count(row.jobs),
    detailedPlansDeleted: count(row.plans),
    repositorySnapshotsDeleted: count(row.snapshots),
    staleCandidatesDeleted: count(row.candidates),
    rateLimitBucketsDeleted: count(row.rates)
  };
}

function collectProgressPlanIds(users: Record<string, Record<string, unknown>>) {
  return new Set(Object.values(users).flatMap((plans) => Object.keys(plans)));
}

function collectNewestPlanIds(plans: DetailedStudyPlan[]) {
  const newest = new Map<string, DetailedStudyPlan>();
  for (const plan of plans) {
    const cache = plan.cache;
    const key = `${plan.repoId}:${plan.duration}:${cache?.preferenceLevel ?? "legacy"}:${cache?.preferenceGoal ?? "legacy"}`;
    const current = newest.get(key);
    if (!current || current.generatedAt < plan.generatedAt) newest.set(key, plan);
  }
  return new Set([...newest.values()].map((plan) => plan.id));
}

async function appendRadarArchive(runs: RadarRun[]) {
  if (runs.length === 0) return;
  const archiveFile = process.env.RADAR_RUN_ARCHIVE_FILE
    ? path.resolve(process.env.RADAR_RUN_ARCHIVE_FILE)
    : path.join(process.cwd(), ".data", "archive", "radar-runs.json");
  const existing = await readJson<{ runs?: RadarRun[] }>(archiveFile, {});
  const byRunId = new Map((existing.runs ?? []).map((run) => [run.runId, run]));
  for (const run of runs) byRunId.set(run.runId, run);
  await writeJsonAtomically(archiveFile, {
    runs: [...byRunId.values()].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
  });
}

function getDataFile(envName: string, filename: string) {
  const configured = process.env[envName];
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".data", filename);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomically(file: string, value: unknown) {
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, file);
}

function cutoffDate(now: Date, days: number) {
  return new Date(now.getTime() - days * 86_400_000);
}

function isBefore(value: string | null | undefined, cutoff: Date) {
  const timestamp = dateNumber(value);
  return Number.isFinite(timestamp) && timestamp < cutoff.getTime();
}

function dateNumber(value: string | null | undefined) {
  return new Date(value ?? "").getTime();
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}
