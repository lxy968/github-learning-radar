import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSqlClient } from "@/lib/db/client";
import { defaultPreference } from "@/lib/seed-data";
import type { Difficulty, RadarCategory, RefreshInterval, UserPreference } from "@/lib/types";

type LocalPreferenceStore = {
  preferences: Record<string, UserPreference>;
};

const dataDir = path.join(process.cwd(), ".data");
const publicRadarUserId = "system-radar";
const legacyUserId = "legacy-demo-user";
let mutationQueue = Promise.resolve();

const allowedInterests: RadarCategory[] = [
  "ai-app",
  "frontend",
  "backend",
  "devtool",
  "database",
  "automation",
  "cli",
  "fullstack"
];
const allowedLevels: Difficulty[] = ["beginner", "intermediate", "advanced"];
const allowedGoals: UserPreference["goal"][] = ["clone", "portfolio", "trend", "source-reading"];
const allowedRefreshIntervals: RefreshInterval[] = ["daily", "three-days", "weekly", "monthly", "never"];

export async function getUserPreference(userId: string): Promise<UserPreference> {
  const sql = getSqlClient();
  if (sql) {
    const rows = await sql`SELECT * FROM user_preferences WHERE user_id = ${userId} LIMIT 1`;
    return rows[0] ? normalizePreference(rows[0]) : defaultPreference;
  }

  const store = await readLocalStore();
  return store.preferences[userId] ?? defaultPreference;
}

export function getPublicRadarPreference() {
  return getUserPreference(publicRadarUserId);
}

export async function saveUserPreference(preference: UserPreference, userId: string) {
  const normalized = normalizePreference(preference);
  const sql = getSqlClient();

  if (sql) {
    await sql`
      INSERT INTO user_preferences (user_id, interests, languages, level, goal, refresh_interval, updated_at)
      VALUES (
        ${userId},
        ${sql.json(normalized.interests as never)},
        ${sql.json(normalized.languages as never)},
        ${normalized.level},
        ${normalized.goal},
        ${normalized.refreshInterval},
        ${new Date().toISOString()}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        interests = EXCLUDED.interests,
        languages = EXCLUDED.languages,
        level = EXCLUDED.level,
        goal = EXCLUDED.goal,
        refresh_interval = EXCLUDED.refresh_interval,
        updated_at = EXCLUDED.updated_at
    `;
    return normalized;
  }

  await mutateLocalStore((store) => {
    store.preferences[userId] = normalized;
  });
  return normalized;
}

export async function deleteUserPreference(userId: string) {
  const sql = getSqlClient();
  if (sql) {
    await sql`DELETE FROM user_preferences WHERE user_id = ${userId}`;
    return;
  }
  await mutateLocalStore((store) => {
    delete store.preferences[userId];
  });
}

async function readLocalStore(): Promise<LocalPreferenceStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(getPreferencesFile(), "utf8")) as Record<string, unknown>;
    if (parsed.preferences && typeof parsed.preferences === "object" && !Array.isArray(parsed.preferences)) {
      return {
        preferences: Object.fromEntries(
          Object.entries(parsed.preferences as Record<string, unknown>).map(([userId, preference]) => [
            userId,
            normalizePreference((preference ?? {}) as Record<string, unknown>)
          ])
        )
      };
    }
    return { preferences: { [legacyUserId]: normalizePreference(parsed) } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { preferences: {} };
    throw error;
  }
}

async function mutateLocalStore(mutate: (store: LocalPreferenceStore) => void) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const store = await readLocalStore();
    mutate(store);
    const preferencesFile = getPreferencesFile();
    const temporaryFile = `${preferencesFile}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(preferencesFile), { recursive: true });
    await fs.writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, preferencesFile);
  } finally {
    release();
  }
}

function getPreferencesFile() {
  return process.env.PREFERENCE_STORE_FILE
    ? path.resolve(process.env.PREFERENCE_STORE_FILE)
    : path.join(dataDir, "preferences.json");
}

function normalizePreference(input: Partial<UserPreference> | Record<string, unknown>): UserPreference {
  const rawInterests = Array.isArray(input.interests) ? input.interests : defaultPreference.interests;
  const rawLanguages = Array.isArray(input.languages) ? input.languages : defaultPreference.languages;
  const interests = rawInterests.filter((item): item is RadarCategory => allowedInterests.includes(item as RadarCategory));
  const languages = rawLanguages
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const level = allowedLevels.includes(input.level as Difficulty) ? (input.level as Difficulty) : defaultPreference.level;
  const goal = allowedGoals.includes(input.goal as UserPreference["goal"])
    ? (input.goal as UserPreference["goal"])
    : defaultPreference.goal;
  const inputRecord = input as Record<string, unknown>;
  const refreshIntervalValue = input.refreshInterval ?? inputRecord.refresh_interval;
  const refreshInterval = allowedRefreshIntervals.includes(refreshIntervalValue as RefreshInterval)
    ? (refreshIntervalValue as RefreshInterval)
    : defaultPreference.refreshInterval;

  return {
    interests: interests.length > 0 ? interests : defaultPreference.interests,
    languages: languages.length > 0 ? languages : defaultPreference.languages,
    level,
    goal,
    refreshInterval
  };
}
