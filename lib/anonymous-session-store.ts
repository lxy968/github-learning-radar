import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSqlClient } from "@/lib/db/client";

type AnonymousSessionRecord = {
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

type LocalSessionStore = {
  sessions: Record<string, AnonymousSessionRecord>;
};

type ExpiredSessionCleanupOptions = {
  now?: Date;
  limit?: number;
  beforeLocalDelete?: (userId: string) => Promise<void>;
};

let mutationQueue = Promise.resolve();

export async function registerAnonymousSession(userId: string, expiresAt: Date, now = new Date()) {
  assertAnonymousUserId(userId);
  const sql = getSqlClient();
  const timestamp = now.toISOString();
  const expiration = expiresAt.toISOString();

  if (sql) {
    const rows = await sql`
      INSERT INTO anonymous_sessions (user_id, created_at, last_seen_at, expires_at)
      VALUES (${userId}, ${timestamp}, ${timestamp}, ${expiration})
      ON CONFLICT (user_id) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        expires_at = EXCLUDED.expires_at
      WHERE anonymous_sessions.expires_at > ${timestamp}
      RETURNING user_id
    `;
    return rows.length === 1;
  }

  return mutateLocalStore((store) => {
    const existing = store.sessions[userId];
    if (existing && existing.expiresAt <= timestamp) return false;
    store.sessions[userId] = {
      userId,
      createdAt: existing?.createdAt ?? timestamp,
      lastSeenAt: timestamp,
      expiresAt: expiration
    };
    return true;
  });
}

export async function touchAnonymousSession(userId: string, expiresAt: Date, now = new Date()) {
  assertAnonymousUserId(userId);
  const sql = getSqlClient();
  const timestamp = now.toISOString();
  const expiration = expiresAt.toISOString();

  if (sql) {
    const rows = await sql`
      UPDATE anonymous_sessions
      SET last_seen_at = ${timestamp}, expires_at = ${expiration}
      WHERE user_id = ${userId} AND expires_at > ${timestamp}
      RETURNING user_id
    `;
    return rows.length === 1;
  }

  return mutateLocalStore((store) => {
    const existing = store.sessions[userId];
    if (!existing || existing.expiresAt <= timestamp) return false;
    store.sessions[userId] = { ...existing, lastSeenAt: timestamp, expiresAt: expiration };
    return true;
  });
}

export async function deleteAnonymousSession(userId: string) {
  assertAnonymousUserId(userId);
  const sql = getSqlClient();

  if (sql) {
    await sql`DELETE FROM anonymous_sessions WHERE user_id = ${userId}`;
    return;
  }

  await mutateLocalStore((store) => {
    delete store.sessions[userId];
  });
}

export async function deleteExpiredAnonymousSessions({
  now = new Date(),
  limit = 100,
  beforeLocalDelete
}: ExpiredSessionCleanupOptions = {}) {
  const sql = getSqlClient();
  const cutoff = now.toISOString();
  const batchSize = Math.max(1, Math.min(1_000, Math.trunc(limit)));

  if (sql) {
    const rows = await sql`
      WITH expired AS (
        SELECT user_id
        FROM anonymous_sessions
        WHERE expires_at <= ${cutoff}
          AND user_id ~ '^anon_[0-9a-f]{64}$'
        ORDER BY expires_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      DELETE FROM anonymous_sessions
      USING expired
      WHERE anonymous_sessions.user_id = expired.user_id
        AND anonymous_sessions.expires_at <= ${cutoff}
      RETURNING anonymous_sessions.user_id
    `;
    return {
      storage: "postgres" as const,
      deletedUserIds: rows.map((row) => String(row.user_id))
    };
  }

  return mutateLocalStore(async (store) => {
    const deletedUserIds = Object.values(store.sessions)
      .filter((session) => session.expiresAt <= cutoff)
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
      .slice(0, batchSize)
      .map((session) => session.userId);

    for (const expiredUserId of deletedUserIds) {
      await beforeLocalDelete?.(expiredUserId);
      delete store.sessions[expiredUserId];
    }

    return { storage: "local-json" as const, deletedUserIds };
  });
}

function assertAnonymousUserId(userId: string) {
  if (!/^anon_[a-f0-9]{64}$/.test(userId)) throw new Error("Invalid anonymous user id.");
}

async function readLocalStore(): Promise<LocalSessionStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(getSessionsFile(), "utf8")) as Partial<LocalSessionStore>;
    return { sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: {} };
    throw error;
  }
}

async function mutateLocalStore<T>(mutate: (store: LocalSessionStore) => T | Promise<T>) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    const store = await readLocalStore();
    const result = await mutate(store);
    const sessionsFile = getSessionsFile();
    const directory = path.dirname(sessionsFile);
    const temporaryFile = `${sessionsFile}.${randomUUID()}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, sessionsFile);
    return result;
  } finally {
    release();
  }
}

function getSessionsFile() {
  return process.env.ANONYMOUS_SESSION_STORE_FILE
    ? path.resolve(process.env.ANONYMOUS_SESSION_STORE_FILE)
    : path.join(process.cwd(), ".data", "anonymous-sessions.json");
}
