import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { redactOperationalError } from "@/lib/api-security";
import { getSqlClient } from "@/lib/db/client";
import type { JobRun, JobRunStatus } from "@/lib/types";

type LocalJobRunStore = {
  jobs: JobRun[];
};

export type CreateJobRunInput = {
  runId?: string;
  idempotencyKey: string;
  jobName: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
};

const terminalStatuses = new Set<JobRunStatus>(["success", "partial", "failed", "cancelled"]);
const dataDir = path.join(process.cwd(), ".data");

export function createDailyRadarIdempotencyKey(referenceDate = new Date()) {
  return `daily-radar:${referenceDate.toISOString().slice(0, 10)}`;
}

export async function createOrReuseJobRun(input: CreateJobRunInput, now = new Date()) {
  const normalized = normalizeCreateInput(input, now);
  const sql = getSqlClient();

  if (sql) {
    const inserted = await sql`
      INSERT INTO job_runs (
        run_id,
        idempotency_key,
        job_name,
        status,
        stage,
        progress_completed,
        progress_total,
        attempt_count,
        max_attempts,
        payload,
        summary,
        created_at,
        updated_at
      )
      VALUES (
        ${normalized.runId},
        ${normalized.idempotencyKey},
        ${normalized.jobName},
        'queued',
        NULL,
        0,
        0,
        0,
        ${normalized.maxAttempts},
        ${sql.json(normalized.payload as never)},
        ${sql.json({} as never)},
        ${normalized.createdAt},
        ${normalized.createdAt}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *
    `;

    if (inserted[0]) return { job: mapJobRunRow(inserted[0]), created: true };
    const existing = await getJobRunByIdempotencyKey(normalized.idempotencyKey);
    if (!existing) throw new Error("Job idempotency conflict was not readable after insert.");
    return { job: existing, created: false };
  }

  return withLocalStoreMutation(async (store) => {
    const existing = store.jobs.find((job) => job.idempotencyKey === normalized.idempotencyKey);
    if (existing) return { result: { job: normalizeJobRun(existing), created: false }, changed: false };

    const job: JobRun = {
      runId: normalized.runId,
      idempotencyKey: normalized.idempotencyKey,
      jobName: normalized.jobName,
      status: "queued",
      stage: null,
      progress: { completed: 0, total: 0 },
      attemptCount: 0,
      maxAttempts: normalized.maxAttempts,
      payload: normalized.payload,
      summary: {},
      errorSummary: null,
      errorCategory: null,
      createdAt: normalized.createdAt,
      availableAt: normalized.createdAt,
      startedAt: null,
      finishedAt: null,
      heartbeatAt: null,
      updatedAt: normalized.createdAt
    };
    store.jobs = [...store.jobs, job].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { result: { job, created: true }, changed: true };
  });
}

export async function getJobRun(runId: string) {
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT * FROM job_runs
      WHERE run_id = ${runId}
      LIMIT 1
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  const store = await readLocalStore();
  const job = store.jobs.find((item) => item.runId === runId);
  return job ? normalizeJobRun(job) : null;
}

export async function getJobRunByIdempotencyKey(idempotencyKey: string) {
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT * FROM job_runs
      WHERE idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  const store = await readLocalStore();
  const job = store.jobs.find((item) => item.idempotencyKey === idempotencyKey);
  return job ? normalizeJobRun(job) : null;
}

export async function listJobRuns(options: { limit?: number; status?: JobRunStatus } = {}) {
  const limit = Math.max(1, Math.min(100, Math.round(options.limit ?? 20)));
  const sql = getSqlClient();

  if (sql) {
    const rows = options.status
      ? await sql`
          SELECT * FROM job_runs
          WHERE status = ${options.status}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT * FROM job_runs
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
    return rows.map(mapJobRunRow);
  }

  const store = await readLocalStore();
  return store.jobs
    .filter((job) => !options.status || job.status === options.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(normalizeJobRun);
}

export async function findActiveJobRunForUser(jobName: string, userId: string) {
  const normalizedJobName = jobName.trim();
  const normalizedUserId = userId.trim();
  if (!normalizedJobName || !normalizedUserId) return null;
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT * FROM job_runs
      WHERE job_name = ${normalizedJobName}
        AND status IN ('queued', 'running')
        AND payload ->> 'userId' = ${normalizedUserId}
      ORDER BY created_at ASC
      LIMIT 1
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  const store = await readLocalStore();
  const job = store.jobs
    .map(normalizeJobRun)
    .filter(
      (item) =>
        item.jobName === normalizedJobName &&
        (item.status === "queued" || item.status === "running") &&
        item.payload.userId === normalizedUserId
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return job ?? null;
}

export async function getJobQueueHealth(jobName: string, now = new Date(), staleAfterMs = 5 * 60_000) {
  const normalizedJobName = jobName.trim();
  if (!normalizedJobName) throw new Error("jobName is required.");
  const timestamp = now.toISOString();
  const staleBefore = new Date(now.getTime() - Math.max(30_000, staleAfterMs)).toISOString();
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
        COUNT(*) FILTER (
          WHERE status = 'queued' AND COALESCE(available_at, created_at) <= ${timestamp}
        ) AS ready_queued_count,
        COUNT(*) FILTER (WHERE status = 'running') AS running_count,
        COUNT(*) FILTER (
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at, created_at) < ${staleBefore}
        ) AS stale_running_count,
        MIN(COALESCE(available_at, created_at)) FILTER (
          WHERE status = 'queued' AND COALESCE(available_at, created_at) <= ${timestamp}
        ) AS oldest_queued_at,
        MAX(finished_at) FILTER (WHERE status IN ('success', 'partial')) AS last_successful_at
      FROM job_runs
      WHERE job_name = ${normalizedJobName}
    `;
    const row = rows[0] ?? {};
    return {
      queued: Number(row.queued_count ?? 0),
      readyQueued: Number(row.ready_queued_count ?? 0),
      running: Number(row.running_count ?? 0),
      staleRunning: Number(row.stale_running_count ?? 0),
      oldestQueuedAt: row.oldest_queued_at ? toIsoString(row.oldest_queued_at) : null,
      lastSuccessfulAt: row.last_successful_at ? toIsoString(row.last_successful_at) : null
    };
  }

  const store = await readLocalStore();
  const jobs = store.jobs.filter((job) => job.jobName === normalizedJobName).map(normalizeJobRun);
  const queued = jobs.filter((job) => job.status === "queued");
  const readyQueued = queued.filter((job) => job.availableAt <= timestamp);
  const running = jobs.filter((job) => job.status === "running");
  const successful = jobs.filter((job) => job.status === "success" || job.status === "partial");
  return {
    queued: queued.length,
    readyQueued: readyQueued.length,
    running: running.length,
    staleRunning: running.filter((job) => (job.heartbeatAt ?? job.startedAt ?? job.createdAt) < staleBefore).length,
    oldestQueuedAt: readyQueued.map((job) => job.availableAt).sort()[0] ?? null,
    lastSuccessfulAt: successful.map((job) => job.finishedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
  };
}

export async function markJobRunRunning(runId: string, stage: string, now = new Date()) {
  const timestamp = now.toISOString();
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      UPDATE job_runs
      SET
        status = 'running',
        stage = ${normalizeStage(stage)},
        attempt_count = attempt_count + 1,
        started_at = COALESCE(started_at, ${timestamp}),
        heartbeat_at = ${timestamp},
        updated_at = ${timestamp}
      WHERE run_id = ${runId}
        AND status = 'queued'
        AND available_at <= ${timestamp}
        AND attempt_count < max_attempts
      RETURNING *
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  return mutateLocalJob(runId, (job) => {
    if (job.status !== "queued" || job.availableAt > timestamp || job.attemptCount >= job.maxAttempts) return null;
    return {
      ...job,
      status: "running",
      stage: normalizeStage(stage),
      attemptCount: job.attemptCount + 1,
      startedAt: job.startedAt ?? timestamp,
      heartbeatAt: timestamp,
      updatedAt: timestamp
    };
  });
}

export async function claimNextJobRun(jobName: string, stage: string, now = new Date()) {
  const normalizedJobName = jobName.trim();
  if (!normalizedJobName) throw new Error("jobName is required.");
  const timestamp = now.toISOString();
  const normalizedStage = normalizeStage(stage);
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      WITH candidate AS (
        SELECT run_id
        FROM job_runs
        WHERE job_name = ${normalizedJobName}
          AND status = 'queued'
          AND available_at <= ${timestamp}
          AND attempt_count < max_attempts
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE job_runs AS jobs
      SET
        status = 'running',
        stage = ${normalizedStage},
        attempt_count = jobs.attempt_count + 1,
        started_at = ${timestamp},
        heartbeat_at = ${timestamp},
        updated_at = ${timestamp}
      FROM candidate
      WHERE jobs.run_id = candidate.run_id
      RETURNING jobs.*
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  return withLocalStoreMutation(async (store) => {
    const index = store.jobs
      .map((job, jobIndex) => ({ job: normalizeJobRun(job), jobIndex }))
      .filter(
        ({ job }) =>
          job.jobName === normalizedJobName &&
          job.status === "queued" &&
          job.availableAt <= timestamp &&
          job.attemptCount < job.maxAttempts
      )
      .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt))[0]?.jobIndex;
    if (index === undefined) return { result: null, changed: false };

    const current = normalizeJobRun(store.jobs[index]);
    const claimed: JobRun = {
      ...current,
      status: "running",
      stage: normalizedStage,
      attemptCount: current.attemptCount + 1,
      startedAt: timestamp,
      heartbeatAt: timestamp,
      updatedAt: timestamp
    };
    store.jobs[index] = claimed;
    return { result: claimed, changed: true };
  });
}

export async function recoverStaleJobRuns(input: {
  jobName: string;
  staleBefore: Date;
  now?: Date;
}) {
  const jobName = input.jobName.trim();
  if (!jobName) throw new Error("jobName is required.");
  const staleBefore = input.staleBefore.toISOString();
  const timestamp = (input.now ?? new Date()).toISOString();
  const recoveryMessage = "Worker heartbeat expired; queued for retry.";
  const failureMessage = "Worker heartbeat expired after the maximum number of attempts.";
  const sql = getSqlClient();

  if (sql) {
    const requeued = await sql`
      UPDATE job_runs
      SET
        status = 'queued',
        stage = 'retry-queued',
        progress_completed = 0,
        progress_total = 0,
        error_summary = ${recoveryMessage},
        error_category = 'worker_stale',
        started_at = NULL,
        heartbeat_at = NULL,
        available_at = ${timestamp},
        updated_at = ${timestamp}
      WHERE job_name = ${jobName}
        AND status = 'running'
        AND COALESCE(heartbeat_at, started_at, created_at) < ${staleBefore}
        AND attempt_count < max_attempts
      RETURNING run_id
    `;
    const failed = await sql`
      UPDATE job_runs
      SET
        status = 'failed',
        error_summary = ${failureMessage},
        error_category = 'worker_stale',
        finished_at = ${timestamp},
        heartbeat_at = ${timestamp},
        updated_at = ${timestamp}
      WHERE job_name = ${jobName}
        AND status = 'running'
        AND COALESCE(heartbeat_at, started_at, created_at) < ${staleBefore}
        AND attempt_count >= max_attempts
      RETURNING run_id
    `;
    return {
      requeuedRunIds: requeued.map((row) => String(row.run_id)),
      failedRunIds: failed.map((row) => String(row.run_id))
    };
  }

  return withLocalStoreMutation(async (store) => {
    const requeuedRunIds: string[] = [];
    const failedRunIds: string[] = [];
    let changed = false;

    store.jobs = store.jobs.map((storedJob) => {
      const job = normalizeJobRun(storedJob);
      const lastHeartbeat = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
      if (job.jobName !== jobName || job.status !== "running" || lastHeartbeat >= staleBefore) return job;
      changed = true;

      if (job.attemptCount < job.maxAttempts) {
        requeuedRunIds.push(job.runId);
        return {
          ...job,
          status: "queued",
          stage: "retry-queued",
          progress: { completed: 0, total: 0 },
          errorSummary: recoveryMessage,
          errorCategory: "worker_stale",
          startedAt: null,
          heartbeatAt: null,
          availableAt: timestamp,
          updatedAt: timestamp
        };
      }

      failedRunIds.push(job.runId);
      return {
        ...job,
        status: "failed",
        errorSummary: failureMessage,
        errorCategory: "worker_stale",
        finishedAt: timestamp,
        heartbeatAt: timestamp,
        updatedAt: timestamp
      };
    });

    return { result: { requeuedRunIds, failedRunIds }, changed };
  });
}

export async function updateJobRunProgress(
  runId: string,
  input: { stage: string; completed: number; total: number },
  now = new Date()
) {
  const timestamp = now.toISOString();
  const progress = normalizeProgress(input.completed, input.total);
  const stage = normalizeStage(input.stage);
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      UPDATE job_runs
      SET
        stage = ${stage},
        progress_completed = ${progress.completed},
        progress_total = ${progress.total},
        heartbeat_at = ${timestamp},
        updated_at = ${timestamp}
      WHERE run_id = ${runId}
        AND status = 'running'
      RETURNING *
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  return mutateLocalJob(runId, (job) => {
    if (job.status !== "running") return null;
    return {
      ...job,
      stage,
      progress,
      heartbeatAt: timestamp,
      updatedAt: timestamp
    };
  });
}

export async function touchJobRunHeartbeat(runId: string, now = new Date()) {
  const timestamp = now.toISOString();
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      UPDATE job_runs
      SET heartbeat_at = ${timestamp}, updated_at = ${timestamp}
      WHERE run_id = ${runId}
        AND status = 'running'
      RETURNING *
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  return mutateLocalJob(runId, (job) => {
    if (job.status !== "running") return null;
    return { ...job, heartbeatAt: timestamp, updatedAt: timestamp };
  });
}

export async function requestJobRunCancellation(runId: string, now = new Date()) {
  const timestamp = now.toISOString();
  const message = "Cancellation requested; the current stage may finish before the job stops.";
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      UPDATE job_runs
      SET
        stage = 'cancel-requested',
        error_summary = ${message},
        error_category = 'user_cancel_requested',
        heartbeat_at = ${timestamp},
        updated_at = ${timestamp}
      WHERE run_id = ${runId}
        AND status = 'running'
      RETURNING *
    `;
    if (rows[0]) return mapJobRunRow(rows[0]);
    const queued = await getJobRun(runId);
    if (queued?.status === "queued") {
      return finishJobRun(runId, {
        status: "cancelled",
        stage: "study-plan-cancelled",
        errorSummary: message,
        errorCategory: "user_cancelled"
      }, now);
    }
    return queued;
  }

  const current = await getJobRun(runId);
  if (current?.status === "queued") {
    return finishJobRun(runId, {
      status: "cancelled",
      stage: "study-plan-cancelled",
      errorSummary: message,
      errorCategory: "user_cancelled"
    }, now);
  }
  return mutateLocalJob(runId, (job) => {
    if (job.status !== "running") return job;
    return {
      ...job,
      stage: "cancel-requested",
      errorSummary: message,
      errorCategory: "user_cancel_requested",
      heartbeatAt: timestamp,
      updatedAt: timestamp
    };
  });
}

export async function requeueJobRun(
  runId: string,
  input: { delayMs: number; errorSummary: string; errorCategory: string },
  now = new Date()
) {
  const timestamp = now.toISOString();
  const availableAt = new Date(now.getTime() + Math.max(0, Math.round(input.delayMs))).toISOString();
  const errorSummary = redactOperationalError(input.errorSummary, 500);
  const errorCategory = input.errorCategory.trim().slice(0, 100) || "unknown";
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      UPDATE job_runs
      SET
        status = 'queued',
        stage = 'retry-queued',
        progress_completed = 0,
        progress_total = 0,
        error_summary = ${errorSummary},
        error_category = ${errorCategory},
        started_at = NULL,
        heartbeat_at = NULL,
        available_at = ${availableAt},
        updated_at = ${timestamp}
      WHERE run_id = ${runId}
        AND status = 'running'
        AND attempt_count < max_attempts
      RETURNING *
    `;
    return rows[0] ? mapJobRunRow(rows[0]) : null;
  }

  return mutateLocalJob(runId, (job) => {
    if (job.status !== "running" || job.attemptCount >= job.maxAttempts) return null;
    return {
      ...job,
      status: "queued",
      stage: "retry-queued",
      progress: { completed: 0, total: 0 },
      errorSummary,
      errorCategory,
      startedAt: null,
      heartbeatAt: null,
      availableAt,
      updatedAt: timestamp
    };
  });
}

export async function finishJobRun(
  runId: string,
  input: {
    status: Extract<JobRunStatus, "success" | "partial" | "failed" | "cancelled">;
    stage?: string | null;
    summary?: Record<string, unknown>;
    errorSummary?: string | null;
    errorCategory?: string | null;
  },
  now = new Date()
) {
  const timestamp = now.toISOString();
  const stage = input.stage === undefined ? null : normalizeNullableStage(input.stage);
  const summary = input.summary ?? {};
  const errorSummary = input.errorSummary ? redactOperationalError(input.errorSummary, 500) : null;
  const errorCategory = input.errorCategory?.trim().slice(0, 100) || null;
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      UPDATE job_runs
      SET
        status = ${input.status},
        stage = COALESCE(${stage}, stage),
        summary = ${sql.json(summary as never)},
        error_summary = ${errorSummary},
        error_category = ${errorCategory},
        finished_at = ${timestamp},
        heartbeat_at = ${timestamp},
        updated_at = ${timestamp}
      WHERE run_id = ${runId}
        AND status IN ('queued', 'running')
      RETURNING *
    `;
    if (rows[0]) return mapJobRunRow(rows[0]);
    const existing = await getJobRun(runId);
    return existing?.status === input.status ? existing : null;
  }

  return mutateLocalJob(runId, (job) => {
    if (terminalStatuses.has(job.status)) return job.status === input.status ? job : null;
    return {
      ...job,
      status: input.status,
      stage: stage ?? job.stage,
      summary,
      errorSummary,
      errorCategory,
      finishedAt: timestamp,
      heartbeatAt: timestamp,
      updatedAt: timestamp
    };
  });
}

function normalizeCreateInput(input: CreateJobRunInput, now: Date) {
  const jobName = input.jobName.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!jobName) throw new Error("jobName is required.");
  if (!idempotencyKey) throw new Error("idempotencyKey is required.");
  if (jobName.length > 80) throw new Error("jobName is too long.");
  if (idempotencyKey.length > 200) throw new Error("idempotencyKey is too long.");

  const createdAt = now.toISOString();
  const safeJobName = jobName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
  return {
    runId: input.runId?.trim() || `${safeJobName}-${createdAt}-${randomUUID().slice(0, 8)}`,
    idempotencyKey,
    jobName,
    maxAttempts: Math.max(1, Math.min(20, Math.round(input.maxAttempts ?? 3))),
    payload: input.payload ?? {},
    createdAt
  };
}

function normalizeProgress(completed: number, total: number) {
  const safeTotal = Math.max(0, Math.round(total));
  const safeCompleted = Math.max(0, Math.min(safeTotal, Math.round(completed)));
  return { completed: safeCompleted, total: safeTotal };
}

function normalizeStage(stage: string) {
  const normalized = stage.trim();
  if (!normalized) throw new Error("stage is required.");
  return normalized.slice(0, 100);
}

function normalizeNullableStage(stage: string | null) {
  if (stage === null) return null;
  return normalizeStage(stage);
}

function mapJobRunRow(row: Record<string, unknown>): JobRun {
  return normalizeJobRun({
    runId: String(row.run_id),
    idempotencyKey: String(row.idempotency_key),
    jobName: String(row.job_name),
    status: normalizeStatus(row.status),
    stage: row.stage ? String(row.stage) : null,
    progress: {
      completed: Number(row.progress_completed ?? 0),
      total: Number(row.progress_total ?? 0)
    },
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    payload: toRecord(row.payload),
    summary: toRecord(row.summary),
    errorSummary: row.error_summary ? String(row.error_summary) : null,
    errorCategory: row.error_category ? String(row.error_category) : null,
    createdAt: toIsoString(row.created_at),
    availableAt: toIsoString(row.available_at ?? row.created_at),
    startedAt: row.started_at ? toIsoString(row.started_at) : null,
    finishedAt: row.finished_at ? toIsoString(row.finished_at) : null,
    heartbeatAt: row.heartbeat_at ? toIsoString(row.heartbeat_at) : null,
    updatedAt: toIsoString(row.updated_at)
  });
}

function normalizeJobRun(job: JobRun): JobRun {
  return {
    ...job,
    runId: String(job.runId ?? ""),
    idempotencyKey: String(job.idempotencyKey ?? job.runId ?? ""),
    jobName: String(job.jobName ?? "unknown-job"),
    status: normalizeStatus(job.status),
    stage: job.stage || null,
    progress: normalizeProgress(job.progress?.completed ?? 0, job.progress?.total ?? 0),
    attemptCount: Math.max(0, Math.round(job.attemptCount ?? 0)),
    maxAttempts: Math.max(1, Math.round(job.maxAttempts ?? 3)),
    payload: toRecord(job.payload),
    summary: toRecord(job.summary),
    errorSummary: job.errorSummary ? redactOperationalError(job.errorSummary, 500) : null,
    errorCategory: job.errorCategory ? String(job.errorCategory).slice(0, 100) : null,
    createdAt: toIsoString(job.createdAt),
    availableAt: toIsoString(job.availableAt ?? job.createdAt),
    startedAt: job.startedAt ? toIsoString(job.startedAt) : null,
    finishedAt: job.finishedAt ? toIsoString(job.finishedAt) : null,
    heartbeatAt: job.heartbeatAt ? toIsoString(job.heartbeatAt) : null,
    updatedAt: toIsoString(job.updatedAt)
  };
}

function normalizeStatus(value: unknown): JobRunStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "partial" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "failed";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
}

async function mutateLocalJob(runId: string, mutate: (job: JobRun) => JobRun | null) {
  return withLocalStoreMutation(async (store) => {
    const index = store.jobs.findIndex((job) => job.runId === runId);
    if (index < 0) return { result: null, changed: false };
    const current = normalizeJobRun(store.jobs[index]);
    const next = mutate(current);
    if (!next) return { result: null, changed: false };
    store.jobs[index] = next;
    return { result: next, changed: true };
  });
}

async function withLocalStoreMutation<T>(
  mutate: (store: LocalJobRunStore) => Promise<{ result: T; changed: boolean }>
) {
  const mutationState = getLocalMutationState();
  const previousMutation = mutationState.tail;
  let release: () => void = () => undefined;
  mutationState.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousMutation;

  try {
    const store = await readLocalStore();
    const outcome = await mutate(store);
    if (outcome.changed) await writeLocalStore(store);
    return outcome.result;
  } finally {
    release();
  }
}

async function readLocalStore(): Promise<LocalJobRunStore> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const content = await fs.readFile(getJobRunsFile(), "utf8");
      const parsed = JSON.parse(content) as Partial<LocalJobRunStore>;
      return {
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs.map(normalizeJobRun) : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { jobs: [] };
      if (attempt >= 4 || !isTransientLocalFileError(error)) throw error;
      await waitForLocalFile(20 * (attempt + 1));
    }
  }
  return { jobs: [] };
}

async function writeLocalStore(store: LocalJobRunStore) {
  const jobRunsFile = getJobRunsFile();
  const directory = path.dirname(jobRunsFile);
  const temporaryFile = `${jobRunsFile}.${randomUUID()}.tmp`;
  const content = `${JSON.stringify(store, null, 2)}\n`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporaryFile, content, "utf8");
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.rename(temporaryFile, jobRunsFile);
        return;
      } catch (error) {
        if (attempt >= 5 || !isTransientLocalFileError(error)) break;
        await waitForLocalFile(25 * (attempt + 1));
      }
    }

    // Windows development tools can briefly lock the existing JSON file and reject rename.
    // Local mutations are serialized, so a retried direct replacement is the safest fallback.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.writeFile(jobRunsFile, content, "utf8");
        return;
      } catch (error) {
        if (attempt >= 5 || !isTransientLocalFileError(error)) throw error;
        await waitForLocalFile(25 * (attempt + 1));
      }
    }
  } finally {
    await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
  }
}

function getLocalMutationState() {
  const globalState = globalThis as typeof globalThis & {
    __learningRadarJobMutationState?: { tail: Promise<void> };
  };
  globalState.__learningRadarJobMutationState ??= { tail: Promise.resolve() };
  return globalState.__learningRadarJobMutationState;
}

function isTransientLocalFileError(error: unknown) {
  if (error instanceof SyntaxError) return true;
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "EEXIST";
}

function waitForLocalFile(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function getJobRunsFile() {
  return process.env.JOB_RUN_STORE_FILE
    ? path.resolve(process.env.JOB_RUN_STORE_FILE)
    : path.join(dataDir, "job-runs.json");
}
