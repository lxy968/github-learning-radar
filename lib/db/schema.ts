import {
  boolean,
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const repositories = pgTable("repositories", {
  id: serial("id").primaryKey(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  fullName: text("full_name").notNull(),
  ownerLogin: text("owner_login").notNull(),
  name: text("name").notNull(),
  htmlUrl: text("html_url").notNull(),
  description: text("description"),
  homepage: text("homepage"),
  category: text("category"),
  primaryLanguage: text("primary_language"),
  licenseSpdx: text("license_spdx"),
  topics: jsonb("topics").$type<string[]>().notNull().default([]),
  languages: jsonb("languages").$type<Array<{ name: string; bytes: number }>>().notNull().default([]),
  readmeExcerpt: text("readme_excerpt").notNull().default(""),
  detectedFiles: jsonb("detected_files").$type<string[]>().notNull().default([]),
  hasTests: boolean("has_tests").notNull().default(false),
  hasExamples: boolean("has_examples").notNull().default(false),
  hasCi: boolean("has_ci").notNull().default(false),
  hasDocker: boolean("has_docker").notNull().default(false),
  enrichmentSignals: jsonb("enrichment_signals").notNull().default({}),
  dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
  isFork: boolean("is_fork").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  sizeKb: integer("size_kb").notNull().default(0),
  pushedAt: timestamp("pushed_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at")
});

export const repositorySnapshots = pgTable(
  "repository_snapshots",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id").notNull(),
    snapshotDate: text("snapshot_date").notNull(),
    stars: integer("stars").notNull(),
    forks: integer("forks").notNull(),
    openIssues: integer("open_issues").notNull(),
    pushedAt: timestamp("pushed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    repoDateIdx: uniqueIndex("repository_snapshots_repo_date_idx").on(table.repoId, table.snapshotDate)
  })
);

export const repoScores = pgTable(
  "repo_scores",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id").notNull(),
    runId: text("run_id").notNull(),
    trendScore: integer("trend_score").notNull(),
    learningValueScore: integer("learning_value_score").notNull(),
    cloneabilityScore: integer("cloneability_score").notNull(),
    repoHealthScore: integer("repo_health_score").notNull(),
    userMatchScore: integer("user_match_score").notNull(),
    finalScore: integer("final_score").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    risks: jsonb("risks").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runRepoIdx: uniqueIndex("repo_scores_run_repo_idx").on(table.runId, table.repoId)
  })
);

export const repoAnalyses = pgTable(
  "repo_analyses",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id").notNull(),
    runId: text("run_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    source: text("source").notNull(),
    fallbackReason: text("fallback_reason"),
    providerAttempts: jsonb("provider_attempts").notNull().default([]),
    analysis: jsonb("analysis").notNull(),
    confidence: real("confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runRepoIdx: uniqueIndex("repo_analyses_run_repo_idx").on(table.runId, table.repoId)
  })
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    runId: text("run_id").notNull(),
    recommendationDate: text("recommendation_date").notNull(),
    rank: integer("rank").notNull(),
    score: integer("score").notNull(),
    reason: text("reason").notNull(),
    analysisSource: text("analysis_source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runRepoIdx: uniqueIndex("recommendations_run_repo_idx").on(table.runId, table.repoId),
    runRankIdx: uniqueIndex("recommendations_run_rank_idx").on(table.runId, table.rank)
  })
);

export const radarRuns = pgTable("radar_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  runDate: text("run_date").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  rawCandidateCount: integer("raw_candidate_count").notNull().default(0),
  recommendationCount: integer("recommendation_count").notNull().default(0),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  preferenceSnapshot: jsonb("preference_snapshot").notNull().default({}),
  metrics: jsonb("metrics").notNull().default({}),
  recommendations: jsonb("recommendations").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const radarRunArchives = pgTable("radar_run_archives", {
  runId: text("run_id").primaryKey(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
  run: jsonb("run").notNull()
});

export const repoInteractions = pgTable(
  "repo_interactions",
  {
    userId: text("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    wantToLearn: boolean("want_to_learn").notNull().default(false),
    bookmarked: boolean("bookmarked").notNull().default(false),
    skipped: boolean("skipped").notNull().default(false),
    tooHard: boolean("too_hard").notNull().default(false),
    tooEasy: boolean("too_easy").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.repoId] })
  })
);

export const anonymousSessions = pgTable("anonymous_sessions", {
  userId: text("user_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});

export const learningProgress = pgTable(
  "learning_progress",
  {
    userId: text("user_id").notNull(),
    planId: text("plan_id").notNull(),
    stepId: text("step_id").notNull(),
    completed: boolean("completed").notNull().default(false),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true }).notNull(),
    serverUpdatedAt: timestamp("server_updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.planId, table.stepId] })
  })
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  interests: jsonb("interests").$type<string[]>().notNull().default([]),
  languages: jsonb("languages").$type<string[]>().notNull().default([]),
  level: text("level").notNull().default("intermediate"),
  goal: text("goal").notNull().default("clone"),
  refreshInterval: text("refresh_interval").notNull().default("daily"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const feedbackEvents = pgTable("feedback_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  userId: text("user_id").notNull(),
  repoId: integer("repo_id").notNull(),
  eventType: text("event_type").notNull(),
  value: boolean("value").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const jobRuns = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  jobName: text("job_name").notNull(),
  status: text("status").notNull(),
  stage: text("stage"),
  progressCompleted: integer("progress_completed").notNull().default(0),
  progressTotal: integer("progress_total").notNull().default(0),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  payload: jsonb("payload").notNull().default({}),
  summary: jsonb("summary").notNull().default({}),
  errorSummary: text("error_summary"),
  errorCategory: text("error_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const detailedStudyPlans = pgTable(
  "detailed_study_plans",
  {
    planId: text("plan_id").primaryKey(),
    repoId: bigint("repo_id", { mode: "number" }).notNull(),
    repoFullName: text("repo_full_name").notNull(),
    duration: integer("duration").notNull(),
    source: text("source").notNull(),
    basedOnPushedAt: timestamp("based_on_pushed_at", { withTimezone: true }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    cacheKey: text("cache_key").notNull(),
    inputHash: text("input_hash").notNull(),
    preferenceLevel: text("preference_level").notNull(),
    preferenceGoal: text("preference_goal").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    cacheProvider: text("cache_provider").notNull(),
    cacheModel: text("cache_model").notNull(),
    plan: jsonb("plan").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    cacheKeyIdx: uniqueIndex("detailed_study_plans_cache_key_idx").on(table.cacheKey)
  })
);

export const apiRateLimits = pgTable("api_rate_limits", {
  rateKey: text("rate_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
