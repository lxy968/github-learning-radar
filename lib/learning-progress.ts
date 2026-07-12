import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSqlClient } from "@/lib/db/client";

export type LearningProgressEntry = {
  stepId: string;
  completed: boolean;
  updatedAt: string;
};

type LocalProgressStore = {
  users: Record<string, Record<string, Record<string, LearningProgressEntry>>>;
};

const progressFileDefault = path.join(process.cwd(), ".data", "learning-progress.json");
let mutationQueue = Promise.resolve();

export async function getLearningProgress(userId: string, planId: string) {
  const sql = getSqlClient();
  if (sql) {
    const rows = await sql`
      SELECT step_id, completed, client_updated_at
      FROM learning_progress
      WHERE user_id = ${userId} AND plan_id = ${planId}
      ORDER BY step_id
    `;
    return rows.map((row) => ({
      stepId: String(row.step_id),
      completed: Boolean(row.completed),
      updatedAt: toIsoString(row.client_updated_at)
    }));
  }
  const store = await readLocalStore();
  return Object.values(store.users[userId]?.[planId] ?? {}).sort((a, b) => a.stepId.localeCompare(b.stepId));
}

export async function mergeLearningProgress(
  userId: string,
  planId: string,
  updates: LearningProgressEntry[],
  now = new Date()
) {
  const normalized = updates.map((entry) => normalizeEntry(entry, now));
  const sql = getSqlClient();
  if (sql) {
    await sql.begin(async (transaction) => {
      for (const entry of normalized) {
        await transaction`
          INSERT INTO learning_progress (
            user_id, plan_id, step_id, completed, client_updated_at, server_updated_at
          )
          VALUES (
            ${userId}, ${planId}, ${entry.stepId}, ${entry.completed}, ${entry.updatedAt}, ${now.toISOString()}
          )
          ON CONFLICT (user_id, plan_id, step_id) DO UPDATE SET
            completed = EXCLUDED.completed,
            client_updated_at = EXCLUDED.client_updated_at,
            server_updated_at = EXCLUDED.server_updated_at
          WHERE learning_progress.client_updated_at < EXCLUDED.client_updated_at
        `;
      }
    });
    return getLearningProgress(userId, planId);
  }

  await mutateLocalStore((store) => {
    store.users[userId] ??= {};
    store.users[userId][planId] ??= {};
    for (const entry of normalized) {
      const current = store.users[userId][planId][entry.stepId];
      if (!current || current.updatedAt < entry.updatedAt) store.users[userId][planId][entry.stepId] = entry;
    }
  });
  return getLearningProgress(userId, planId);
}

export async function deleteLearningProgress(userId: string) {
  const sql = getSqlClient();
  if (sql) {
    await sql`DELETE FROM learning_progress WHERE user_id = ${userId}`;
    return;
  }
  await mutateLocalStore((store) => {
    delete store.users[userId];
  });
}

function normalizeEntry(entry: LearningProgressEntry, now: Date): LearningProgressEntry {
  const parsed = new Date(entry.updatedAt);
  const latestAllowed = now.getTime() + 5 * 60_000;
  const timestamp = Number.isFinite(parsed.getTime()) ? Math.min(parsed.getTime(), latestAllowed) : now.getTime();
  return {
    stepId: entry.stepId.trim().slice(0, 160),
    completed: Boolean(entry.completed),
    updatedAt: new Date(timestamp).toISOString()
  };
}

async function readLocalStore(): Promise<LocalProgressStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(getProgressFile(), "utf8")) as Partial<LocalProgressStore>;
    return { users: parsed.users && typeof parsed.users === "object" ? parsed.users : {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { users: {} };
    throw error;
  }
}

async function mutateLocalStore(mutate: (store: LocalProgressStore) => void) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const store = await readLocalStore();
    mutate(store);
    const progressFile = getProgressFile();
    const temporaryFile = `${progressFile}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(progressFile), { recursive: true });
    await fs.writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, progressFile);
  } finally {
    release();
  }
}

function getProgressFile() {
  return process.env.LEARNING_PROGRESS_STORE_FILE
    ? path.resolve(process.env.LEARNING_PROGRESS_STORE_FILE)
    : progressFileDefault;
}

function toIsoString(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
