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

let mutationQueue = Promise.resolve();

export async function touchAnonymousSession(userId: string, expiresAt: Date, now = new Date()) {
  assertAnonymousUserId(userId);
  const sql = getSqlClient();
  const timestamp = now.toISOString();
  const expiration = expiresAt.toISOString();

  if (sql) {
    await sql`
      INSERT INTO anonymous_sessions (user_id, created_at, last_seen_at, expires_at)
      VALUES (${userId}, ${timestamp}, ${timestamp}, ${expiration})
      ON CONFLICT (user_id) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        expires_at = GREATEST(anonymous_sessions.expires_at, EXCLUDED.expires_at)
    `;
    return;
  }

  await mutateLocalStore((store) => {
    const existing = store.sessions[userId];
    store.sessions[userId] = {
      userId,
      createdAt: existing?.createdAt ?? timestamp,
      lastSeenAt: timestamp,
      expiresAt: existing && existing.expiresAt > expiration ? existing.expiresAt : expiration
    };
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

async function mutateLocalStore(mutate: (store: LocalSessionStore) => void) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    const store = await readLocalStore();
    mutate(store);
    const sessionsFile = getSessionsFile();
    const directory = path.dirname(sessionsFile);
    const temporaryFile = `${sessionsFile}.${randomUUID()}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, sessionsFile);
  } finally {
    release();
  }
}

function getSessionsFile() {
  return process.env.ANONYMOUS_SESSION_STORE_FILE
    ? path.resolve(process.env.ANONYMOUS_SESSION_STORE_FILE)
    : path.join(process.cwd(), ".data", "anonymous-sessions.json");
}
