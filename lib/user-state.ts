import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSqlClient } from "@/lib/db/client";
import { getCurrentRecommendations } from "@/lib/radar";
import type { FeedbackEvent, FeedbackEventType, RepoInteraction } from "@/lib/types";

type LocalUserData = {
  feedbackEvents: FeedbackEvent[];
  interactions: Record<string, RepoInteraction>;
};

type LocalUserState = {
  users: Record<string, LocalUserData>;
};

const legacyUserId = "legacy-demo-user";
let mutationQueue = Promise.resolve();

export async function getInteraction(userId: string, repoId: number) {
  const sql = getSqlClient();
  if (sql) {
    const rows = await sql`
      SELECT * FROM repo_interactions
      WHERE user_id = ${userId} AND repo_id = ${repoId}
      LIMIT 1
    `;
    return rows[0] ? mapInteractionRow(rows[0]) : emptyInteraction(repoId);
  }

  const state = await readLocalState();
  return state.users[userId]?.interactions[String(repoId)] ?? emptyInteraction(repoId);
}

export async function listInteractions(userId: string) {
  const sql = getSqlClient();
  if (sql) {
    const rows = await sql`
      SELECT * FROM repo_interactions
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC NULLS LAST
    `;
    return rows.map(mapInteractionRow);
  }
  const state = await readLocalState();
  return Object.values(state.users[userId]?.interactions ?? {});
}

export async function listFeedbackEvents(userId: string, limit = 50) {
  const sql = getSqlClient();
  if (sql) {
    const rows = await sql`
      SELECT * FROM feedback_events
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapFeedbackEventRow);
  }
  const state = await readLocalState();
  return (state.users[userId]?.feedbackEvents ?? []).slice(-limit).reverse();
}

export async function listBookmarkedRecommendations(userId: string) {
  const interactions = await listInteractions(userId);
  const bookmarkedIds = new Set(interactions.filter((item) => item.bookmarked).map((item) => item.repoId));
  return (await getCurrentRecommendations()).filter((item) => bookmarkedIds.has(item.repo.id));
}

export async function recordFeedback(
  userId: string,
  input: {
    repoId: number;
    eventType: FeedbackEventType;
    value: boolean;
    payload?: Record<string, unknown>;
  }
) {
  const sql = getSqlClient();
  const now = new Date().toISOString();
  const event: FeedbackEvent = {
    id: randomUUID(),
    userId,
    repoId: input.repoId,
    eventType: input.eventType,
    value: input.value,
    payload: input.payload,
    createdAt: now
  };

  if (sql) {
    const interaction = await sql.begin(async (transaction) => {
      const currentRows = await transaction`
        SELECT * FROM repo_interactions
        WHERE user_id = ${userId} AND repo_id = ${input.repoId}
        LIMIT 1
      `;
      const current = currentRows[0] ? mapInteractionRow(currentRows[0]) : emptyInteraction(input.repoId);
      const nextInteraction = applyEvent(current, input.eventType, input.value, now);

      await transaction`
        INSERT INTO feedback_events (event_id, user_id, repo_id, event_type, value, payload, created_at)
        VALUES (
          ${event.id}, ${event.userId}, ${event.repoId}, ${event.eventType}, ${event.value},
          ${sql.json((event.payload ?? {}) as never)}, ${event.createdAt}
        )
        ON CONFLICT (event_id) DO NOTHING
      `;
      await transaction`
        INSERT INTO repo_interactions (
          user_id, repo_id, want_to_learn, bookmarked, skipped, too_hard, too_easy, updated_at
        )
        VALUES (
          ${userId}, ${nextInteraction.repoId}, ${nextInteraction.wantToLearn}, ${nextInteraction.bookmarked},
          ${nextInteraction.skipped}, ${nextInteraction.tooHard}, ${nextInteraction.tooEasy}, ${nextInteraction.updatedAt}
        )
        ON CONFLICT (user_id, repo_id) DO UPDATE SET
          want_to_learn = EXCLUDED.want_to_learn,
          bookmarked = EXCLUDED.bookmarked,
          skipped = EXCLUDED.skipped,
          too_hard = EXCLUDED.too_hard,
          too_easy = EXCLUDED.too_easy,
          updated_at = EXCLUDED.updated_at
      `;
      return nextInteraction;
    });
    return { interaction, event };
  }

  let nextInteraction = emptyInteraction(input.repoId);
  await mutateLocalState((state) => {
    const user = getOrCreateUser(state, userId);
    const current = user.interactions[String(input.repoId)] ?? emptyInteraction(input.repoId);
    nextInteraction = applyEvent(current, input.eventType, input.value, now);
    user.interactions[String(input.repoId)] = nextInteraction;
    user.feedbackEvents.push(event);
  });
  return { interaction: nextInteraction, event };
}

export async function deleteUserState(userId: string) {
  const sql = getSqlClient();
  if (sql) {
    await sql.begin(async (transaction) => {
      await transaction`DELETE FROM feedback_events WHERE user_id = ${userId}`;
      await transaction`DELETE FROM repo_interactions WHERE user_id = ${userId}`;
    });
    return;
  }
  await mutateLocalState((state) => {
    delete state.users[userId];
  });
}

async function readLocalState(): Promise<LocalUserState> {
  try {
    const parsed = JSON.parse(await fs.readFile(getStateFile(), "utf8")) as Record<string, unknown>;
    if (parsed.users && typeof parsed.users === "object" && !Array.isArray(parsed.users)) {
      return { users: parsed.users as Record<string, LocalUserData> };
    }
    const feedbackEvents = Array.isArray(parsed.feedbackEvents) ? (parsed.feedbackEvents as FeedbackEvent[]) : [];
    const interactions = isRecord(parsed.interactions)
      ? (parsed.interactions as Record<string, RepoInteraction>)
      : {};
    return { users: { [legacyUserId]: { feedbackEvents, interactions } } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { users: {} };
    throw error;
  }
}

async function mutateLocalState(mutate: (state: LocalUserState) => void) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const state = await readLocalState();
    mutate(state);
    const stateFile = getStateFile();
    const temporaryFile = `${stateFile}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, stateFile);
  } finally {
    release();
  }
}

function getStateFile() {
  return process.env.USER_STATE_STORE_FILE
    ? path.resolve(process.env.USER_STATE_STORE_FILE)
    : path.join(process.cwd(), ".data", "user-state.json");
}

function getOrCreateUser(state: LocalUserState, userId: string) {
  state.users[userId] ??= { feedbackEvents: [], interactions: {} };
  return state.users[userId];
}

function emptyInteraction(repoId: number): RepoInteraction {
  return {
    repoId,
    wantToLearn: false,
    bookmarked: false,
    skipped: false,
    tooHard: false,
    tooEasy: false,
    updatedAt: null
  };
}

function applyEvent(interaction: RepoInteraction, eventType: FeedbackEventType, value: boolean, updatedAt: string) {
  const next = { ...interaction, updatedAt };
  if (eventType === "want_to_learn") {
    next.wantToLearn = value;
    if (value) next.skipped = false;
  }
  if (eventType === "bookmarked") next.bookmarked = value;
  if (eventType === "skipped") {
    next.skipped = value;
    if (value) next.wantToLearn = false;
  }
  if (eventType === "too_hard") {
    next.tooHard = value;
    if (value) next.tooEasy = false;
  }
  if (eventType === "too_easy") {
    next.tooEasy = value;
    if (value) next.tooHard = false;
  }
  return next;
}

function mapInteractionRow(row: Record<string, unknown>): RepoInteraction {
  return {
    repoId: Number(row.repo_id),
    wantToLearn: Boolean(row.want_to_learn),
    bookmarked: Boolean(row.bookmarked),
    skipped: Boolean(row.skipped),
    tooHard: Boolean(row.too_hard),
    tooEasy: Boolean(row.too_easy),
    updatedAt: row.updated_at ? toIsoString(row.updated_at) : null
  };
}

function mapFeedbackEventRow(row: Record<string, unknown>): FeedbackEvent {
  return {
    id: String(row.event_id),
    userId: String(row.user_id),
    repoId: Number(row.repo_id),
    eventType: normalizeEventType(row.event_type),
    value: Boolean(row.value),
    payload: isRecord(row.payload) ? row.payload : {},
    createdAt: toIsoString(row.created_at)
  };
}

function normalizeEventType(value: unknown): FeedbackEventType {
  if (
    value === "want_to_learn" ||
    value === "bookmarked" ||
    value === "skipped" ||
    value === "too_hard" ||
    value === "too_easy"
  ) {
    return value;
  }
  return "skipped";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIsoString(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
