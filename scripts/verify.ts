import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeRepositoryWithFallback,
  createRuleBasedAnalysis,
  repositoryAnalysisPromptVersion,
  repositoryAnalysisSchemaVersion,
  upgradeLegacyRecommendationContent,
  type RepositoryAnalysisResult
} from "../lib/ai/analyze";
import {
  createRuleBasedDetailedStudyPlan,
  generateDetailedStudyPlan,
  normalizeDetailedStudyPlanModelContent,
  parseDetailedStudyPlanModelJson
} from "../lib/ai/detailed-study-plan";
import { getConfiguredAiModel } from "../lib/ai/provider";
import {
  assertBackgroundJobsEnabled,
  getDeploymentMode,
  isShowcaseMode
} from "../lib/deployment-mode";
import {
  buildDetailedStudyPlanCacheMetadata,
  createDetailedStudyPlanGenerationContext,
  detailedStudyPlanPromptVersion,
  detailedStudyPlanSchemaVersion
} from "../lib/detailed-study-plan-cache";
import {
  getOrCreateDetailedStudyPlan,
  listCurrentDetailedStudyPlans,
  listDetailedStudyPlans
} from "../lib/detailed-study-plans";
import {
  cancelDetailedStudyPlanJob,
  enqueueDetailedStudyPlanJob,
  executeDetailedStudyPlanJob
} from "../lib/study-plan-jobs";
import { authorizeAdminRequest, consumeRequestRateLimit } from "../lib/api-security";
import { getDetailedStudyPlanSteps, getDetailedStudyPlanStorageKey } from "../lib/detailed-study-progress";
import {
  anonymousSessionCookieName,
  anonymousSessionMaxAgeSeconds,
  createAnonymousSessionToken,
  deriveAnonymousUserId
} from "../lib/anonymous-session";
import { buildDiscoveryQueries } from "../lib/github/discovery";
import { analyzeScoredCandidates, type DailyRadarRunOptions } from "../lib/daily-radar";
import { getLearningRecommendation, getRadarStats, getRecommendations, getTopCategory } from "../lib/radar";
import { createRadarRunProjection } from "../lib/radar-run-projection";
import { rebuildRadarRunProjections } from "../lib/radar-runs";
import { getRefreshScheduleDecision } from "../lib/refresh-schedule";
import { shouldRequireGithubTokenAtWebEdge } from "../lib/refresh-policy";
import { getJobQueueDegradationReasons } from "../lib/job-health";
import { runFairWorkerCycle, type WorkerKind } from "../lib/worker-scheduler";
import { getSiteUrl } from "../lib/site-url";
import {
  createShowcaseStudyPlan,
  listShowcaseStudyPlans
} from "../lib/showcase-study-plans";
import { showcaseRecommendation, showcaseStudyPlans as generatedShowcaseStudyPlans } from "../lib/showcase-content";
import { runDataRetention, type DataRetentionPolicy } from "../lib/data-retention";
import { classifyOperationalError, getRetryDelayMs, withOperationalRetry } from "../lib/operational-errors";
import { sanitizeReadmeExcerpt } from "../lib/readme";
import { getLearnerCommunicationGuidance, shouldIncludeLearnerGlossary } from "../lib/learning-language";
import {
  createUnknownEnrichmentSignals,
  getRepoSignal,
  normalizeEnrichmentSignals
} from "../lib/repository-signals";
import {
  getRepositoryCandidate,
  listRepositoryCandidates,
  paginateRepositoryCandidates
} from "../lib/repository-store";
import { scoreRepository } from "../lib/scoring";
import { defaultPreference, seedRepos } from "../lib/seed-data";
import { uniqueTextValues } from "../lib/text-lists";
import { RecommendationCard } from "../components/recommendation-card";
import { normalizePublicRepositoryUrl, PortfolioOverview } from "../components/portfolio-overview";
import { DetailedStudyPlanBuilder } from "../components/detailed-study-plan-builder";
import { CandidateRepositoryBrowser } from "../components/candidate-repository-browser";
import { RepositorySignalBadge } from "../components/repository-signal-badge";
import {
  findMissingGitignoreRules,
  findPotentialSecrets,
  findVercelDeploymentConfigIssues
} from "./repository-hygiene";
import { assertPostgresIntegrationTarget } from "./postgres-integration-safety";
import {
  assertMigrationChecksum,
  calculateMigrationChecksum,
  runInReservedTransaction,
  type ReservedTransactionSql
} from "./migration-integrity";
import { isForbiddenHistoricalPath } from "./git-history-secret-scan";
import { exploreNavItems, isNavItemActive, primaryNavItems } from "../components/sidebar-nav";
import type {
  DetailedStudyPlan,
  JobRun,
  RadarRun,
  RuleScore,
  RepoSnapshot,
  UserPreference
} from "../lib/types";
import { POST as createStudyPlan } from "../app/api/study-plans/route";

async function main() {
  verifyProviderSelection();
  verifyProductionConfigPreflight();
  verifyQueueHealthPolicy();
  await verifyFairWorkerScheduler();
  await verifyMigrationIntegrity();
  verifyDeploymentModeBoundary();
  verifyRuntimeSiteUrl();
  verifyRefreshProcessSecretBoundary();
  verifyRepositoryHygieneRules();
  verifyScoring();
  verifyRuleAnalysisDifferentiation();
  verifyLegacyRecommendationUpgrade();
  verifyRepositorySignalStates();
  verifyCandidateServerPagination();
  verifyRadarRunProjection();
  verifyTopCategory();
  verifyPortfolioOverview();
  verifyShowcaseStudyPlanFixture();
  verifyRecommendationCardHierarchy();
  verifyNavigationStructure();
  await verifySingleMainLandmarkSources();
  verifyRefreshSchedule();
  verifyDynamicDiscoveryWindow();
  verifyAdminAuthorization();
  verifyOperationalErrorClassification();
  verifyAnonymousSessionIdentity();
  verifyReadmeSanitizer();
  verifyUniqueTextValues();
  verifyRuleBasedDetailedStudyPlan();
  verifyDetailedStudyPlanModelOutputRecovery();
  verifyLearnerCommunicationGuidance();
  verifyDetailedStudyPlanCacheIdentity();
  await verifyDetailedPlanFocusMode();
  await verifyNoKeyFallback();
  await verifyDetailedStudyPlanFallback();
  await verifyDetailedStudyPlanCachePersistence();
  await verifyStudyPlanBackgroundJobs();
  await verifyProjectionRebuildSkip();
  await verifySingleRepositoryAiFallback();
  await verifyUnexpectedAnalyzerFailure();
  await verifyAiCircuitBreaker();
  await verifyConcurrentAnalysisKeepsRankOrder();
  await verifyAiAnalysisLimit();
  await verifyStudyPlanRequestValidation();
  await verifyShowcaseCostFirewall();
  await verifyAnonymousForceBoundary();
  await verifyRequestRateLimit();
  await verifyDataRetention();
  await verifySessionProxyCookie();
  await verifyAnonymousUserIsolation();
  await verifyOperationalRetry();
  await verifyPersistentJobRuns();
  await verifyManualRefreshRequiresGithubToken();
  await verifyRefreshStatusEndpoint();
  await verifyHealthEndpoint();
  await verifyCandidateStore();
  await verifyCandidateLearningRecommendation();

  console.log("Verification passed");
}

function verifyProviderSelection() {
  const modelEnv = {
    ...process.env,
    DEEPSEEK_API_KEY: "test-deepseek-key",
    DEEPSEEK_FLASH_MODEL: "deepseek-v4-flash",
    DEEPSEEK_PRO_MODEL: "deepseek-v4-pro",
    OPENAI_API_KEY: "test-openai-key"
  };
  const flashConfig = getConfiguredAiModel("radar-analysis", modelEnv);
  const proConfig = getConfiguredAiModel("detailed-study-plan", modelEnv);

  assert.equal(flashConfig?.provider, "deepseek");
  assert.equal(flashConfig?.task, "radar-analysis");
  assert.equal(flashConfig?.modelId, "deepseek-v4-flash");
  assert.equal(proConfig?.task, "detailed-study-plan");
  assert.equal(proConfig?.modelId, "deepseek-v4-pro");

  const openAIOnlyConfig = getConfiguredAiModel("radar-analysis", {
    ...process.env,
    DEEPSEEK_API_KEY: "",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_MODEL: "gpt-4.1-mini"
  });

  assert.equal(openAIOnlyConfig, null);
  assert.equal(
    getConfiguredAiModel("radar-analysis", {
      NODE_ENV: "production",
      APP_DEPLOYMENT_MODE: "showcase",
      DEEPSEEK_API_KEY: "must-not-be-used"
    }),
    null
  );
}

function verifyProductionConfigPreflight() {
  const script = path.join(process.cwd(), "scripts", "production-check.mjs");
  const commonEnv = {
    PATH: process.env.PATH ?? process.env.Path,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: "production",
    APP_DEPLOYMENT_MODE: "full",
    DATABASE_URL: "postgresql://radar@postgres.example.invalid/radar?sslmode=require"
  } as NodeJS.ProcessEnv;
  const web = spawnSync(
    process.execPath,
    [script, "--profile=web", "--json"],
    {
      encoding: "utf8",
      env: {
        ...commonEnv,
        SITE_URL: "https://radar.example.invalid",
        CRON_SECRET: "verification-cron-secret-0000000000000000",
        ADMIN_SECRET: "verification-admin-secret-000000000000000"
      }
    }
  );
  assert.equal(web.status, 0, web.stderr);
  const webResult = JSON.parse(web.stdout) as { ok?: boolean; issues?: unknown[] };
  assert.equal(webResult.ok, true);
  assert.deepEqual(webResult.issues, []);
  assert.equal(web.stdout.includes("postgresql://"), false);

  const publishedWithoutUrl = spawnSync(
    process.execPath,
    [script, "--profile=web", "--json"],
    {
      encoding: "utf8",
      env: {
        ...commonEnv,
        SITE_URL: "https://radar.example.invalid",
        CRON_SECRET: "verification-cron-secret-0000000000000000",
        ADMIN_SECRET: "verification-admin-secret-000000000000000",
        PUBLIC_REPOSITORY_PUBLISHED: "true"
      }
    }
  );
  assert.equal(publishedWithoutUrl.status, 1);
  assert.ok(publishedWithoutUrl.stdout.includes("published_repository_missing"));

  const insecureDatabase = spawnSync(
    process.execPath,
    [script, "--profile=web", "--json"],
    {
      encoding: "utf8",
      env: {
        ...commonEnv,
        DATABASE_URL: "postgresql://radar@postgres.example.invalid/radar",
        SITE_URL: "https://radar.example.invalid",
        CRON_SECRET: "verification-cron-secret-0000000000000000",
        ADMIN_SECRET: "verification-admin-secret-000000000000000"
      }
    }
  );
  assert.equal(insecureDatabase.status, 1);
  assert.ok(insecureDatabase.stdout.includes("database_tls_required"));

  const showcaseWeb = spawnSync(
    process.execPath,
    [script, "--profile=web", "--json"],
    {
      encoding: "utf8",
      env: {
        ...commonEnv,
        APP_DEPLOYMENT_MODE: "showcase",
        SITE_URL: "https://showcase.example.invalid"
      }
    }
  );
  assert.equal(showcaseWeb.status, 0, showcaseWeb.stderr);
  const showcaseResult = JSON.parse(showcaseWeb.stdout) as { ok?: boolean; deploymentMode?: string };
  assert.equal(showcaseResult.ok, true);
  assert.equal(showcaseResult.deploymentMode, "showcase");

  const showcaseWithKey = spawnSync(
    process.execPath,
    [script, "--profile=web", "--json"],
    {
      encoding: "utf8",
      env: {
        ...commonEnv,
        APP_DEPLOYMENT_MODE: "showcase",
        SITE_URL: "https://showcase.example.invalid",
        DEEPSEEK_API_KEY: "must-not-reach-showcase"
      }
    }
  );
  assert.equal(showcaseWithKey.status, 1);
  assert.ok(showcaseWithKey.stdout.includes("showcase_secret_forbidden"));

  const missingWorkerToken = spawnSync(
    process.execPath,
    [script, "--profile=worker", "--json"],
    { encoding: "utf8", env: commonEnv }
  );
  assert.equal(missingWorkerToken.status, 1);
  const workerResult = JSON.parse(missingWorkerToken.stdout) as {
    issues?: Array<{ variable?: string }>;
  };
  assert.ok(workerResult.issues?.some((issue) => issue.variable === "GITHUB_TOKEN"));

  const worker = spawnSync(
    process.execPath,
    [script, "--profile=worker", "--json"],
    {
      encoding: "utf8",
      env: {
        ...commonEnv,
        GITHUB_TOKEN: "verification-github-token-0000000000000000",
        DEEPSEEK_API_KEY: "verification-deepseek-key-000000000000000"
      }
    }
  );
  assert.equal(worker.status, 0, worker.stderr);
  assert.equal((JSON.parse(worker.stdout) as { ok?: boolean }).ok, true);
  assert.equal(worker.stdout.includes("verification-github-token"), false);

  const legacySiteUrl = spawnSync(
    process.execPath,
    [script, "--profile=web", "--json"],
    {
      encoding: "utf8",
      env: {
        ...commonEnv,
        NEXT_PUBLIC_SITE_URL: "https://legacy.example.invalid",
        CRON_SECRET: "verification-cron-secret-0000000000000000",
        ADMIN_SECRET: "verification-admin-secret-000000000000000"
      }
    }
  );
  assert.equal(legacySiteUrl.status, 1);
  assert.ok(legacySiteUrl.stdout.includes("legacy_site_url"));
}

function verifyQueueHealthPolicy() {
  const now = new Date("2030-01-01T00:30:00.000Z");
  assert.deepEqual(
    getJobQueueDegradationReasons(
      "radar",
      { queued: 1, readyQueued: 1, running: 0, staleRunning: 0, oldestQueuedAt: "2030-01-01T00:00:00.000Z" },
      now,
      { maxReadyQueued: 10, maxReadyWaitMs: 10 * 60_000 }
    ),
    ["radar_oldest_ready_exceeded"]
  );
  assert.deepEqual(
    getJobQueueDegradationReasons(
      "study-plan",
      { queued: 12, readyQueued: 10, running: 1, staleRunning: 1, oldestQueuedAt: null },
      now,
      { maxReadyQueued: 10, maxReadyWaitMs: 30 * 60_000 }
    ),
    ["study_plan_stale_running", "study_plan_ready_backlog"]
  );
  assert.deepEqual(
    getJobQueueDegradationReasons(
      "radar",
      { queued: 1, readyQueued: 0, running: 0, staleRunning: 0, oldestQueuedAt: null },
      now,
      { maxReadyQueued: 10, maxReadyWaitMs: 10 * 60_000 }
    ),
    []
  );
}

async function verifyFairWorkerScheduler() {
  const processed = { status: "processed" as const };
  const idle = { status: "idle" as const };
  const order: string[] = [];
  let preferred: WorkerKind = "study-plan";
  for (let cycleIndex = 0; cycleIndex < 4; cycleIndex += 1) {
    const cycle: { nextPreferredKind: WorkerKind } = await runFairWorkerCycle(preferred, {
      studyPlan: async () => {
        order.push("study-plan");
        return processed;
      },
      radar: async () => {
        order.push("radar");
        return processed;
      }
    });
    preferred = cycle.nextPreferredKind;
  }
  assert.deepEqual(order, ["study-plan", "radar", "study-plan", "radar"]);

  const fallbackOrder: string[] = [];
  const fallback = await runFairWorkerCycle("radar", {
    radar: async () => {
      fallbackOrder.push("radar");
      return idle;
    },
    studyPlan: async () => {
      fallbackOrder.push("study-plan");
      return processed;
    }
  });
  assert.deepEqual(fallbackOrder, ["radar", "study-plan"]);
  assert.equal(fallback.worker, "study-plan");
  assert.equal(fallback.nextPreferredKind, "radar");
}

async function verifyMigrationIntegrity() {
  const checksum = calculateMigrationChecksum("SELECT 1;\n");
  assert.match(checksum, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertMigrationChecksum("0001_test.sql", checksum, checksum));
  assert.throws(
    () => assertMigrationChecksum("0001_test.sql", checksum, calculateMigrationChecksum("SELECT 2;\n")),
    /must not be edited/
  );

  const committedCommands: string[] = [];
  const committedSql = createTransactionRecorder(committedCommands);
  await runInReservedTransaction(committedSql, async () => {
    committedCommands.push("APPLY");
  });
  assert.deepEqual(committedCommands, ["BEGIN", "APPLY", "COMMIT"]);

  const rolledBackCommands: string[] = [];
  const rolledBackSql = createTransactionRecorder(rolledBackCommands);
  await assert.rejects(
    runInReservedTransaction(rolledBackSql, async () => {
      rolledBackCommands.push("APPLY");
      throw new Error("simulated migration failure");
    }),
    /simulated migration failure/
  );
  assert.deepEqual(rolledBackCommands, ["BEGIN", "APPLY", "ROLLBACK"]);
}

function createTransactionRecorder(commands: string[]): ReservedTransactionSql {
  return (strings) => {
    commands.push(strings.join("").trim());
    return Promise.resolve([]);
  };
}

function verifyDeploymentModeBoundary() {
  assert.equal(getDeploymentMode({ NODE_ENV: "development" }), "full");
  assert.equal(getDeploymentMode({ NODE_ENV: "production" }), "showcase");
  assert.equal(getDeploymentMode({ NODE_ENV: "production", APP_DEPLOYMENT_MODE: "full" }), "full");
  assert.equal(isShowcaseMode({ NODE_ENV: "production", APP_DEPLOYMENT_MODE: "invalid" }), true);
  assert.throws(
    () => assertBackgroundJobsEnabled("verification job", { NODE_ENV: "production", APP_DEPLOYMENT_MODE: "showcase" }),
    /forbids verification job/
  );
}

function verifyRuntimeSiteUrl() {
  assert.equal(
    getSiteUrl({ SITE_URL: "https://radar.example.invalid/path" })?.href,
    "https://radar.example.invalid/"
  );
  assert.equal(getSiteUrl({ SITE_URL: "not-a-url" }), null);
  assert.equal(
    getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://legacy.example.invalid" })?.origin,
    "https://legacy.example.invalid"
  );
}

function verifyRefreshProcessSecretBoundary() {
  assert.equal(shouldRequireGithubTokenAtWebEdge({ NODE_ENV: "development" }), true);
  assert.equal(shouldRequireGithubTokenAtWebEdge({ NODE_ENV: "production" }), false);
}

function verifyRepositoryHygieneRules() {
  assert.ok(findMissingGitignoreRules("node_modules\n").includes(".env.local"));
  assert.equal(findPotentialSecrets("const token = 'sk-" + "abcdefghijklmnopqrstuvwxyz123456';")[0]?.label, "API secret key");
  assert.equal(
    findPotentialSecrets("postgresql://" + "admin:real-password@example.com/database")[0]?.label,
    "credentialed database URL"
  );
  assert.deepEqual(
    findPotentialSecrets("postgresql://radar:radar_local_integration_only@postgres:5432/radar_integration"),
    []
  );
  assert.deepEqual(findPotentialSecrets("Authorization: Bearer verification-admin-secret"), []);
  assert.deepEqual(
    findVercelDeploymentConfigIssues({
      framework: "nextjs",
      buildCommand: "pnpm production:check -- --profile=web && pnpm build"
    }),
    []
  );
  assert.ok(
    findVercelDeploymentConfigIssues({ framework: "nextjs", buildCommand: "pnpm build", crons: [] }).some(
      (issue) => issue.includes("preflight")
    )
  );
  assert.ok(findVercelDeploymentConfigIssues({ framework: "nextjs", buildCommand: "pnpm build", env: {} }).length > 0);
  assert.equal(isForbiddenHistoricalPath(".env.local"), true);
  assert.equal(isForbiddenHistoricalPath("archive/user-data.sqlite3"), true);
  assert.equal(isForbiddenHistoricalPath(".next/server/app.js"), true);
  assert.equal(isForbiddenHistoricalPath(".env.example"), false);
  assert.doesNotThrow(() =>
    assertPostgresIntegrationTarget(
      "postgresql://radar:radar_local_integration_only@postgres:5432/radar_integration",
      "1"
    )
  );
  assert.throws(
    () => assertPostgresIntegrationTarget("postgresql://radar:secret@postgres:5432/radar_production", "1"),
    /refuses a database/
  );
  assert.throws(
    () => assertPostgresIntegrationTarget("postgresql://radar:secret@postgres:5432/radar_test", undefined),
    /ALLOW_POSTGRES_INTEGRATION_TEST/
  );
}

function verifyScoring() {
  const score = scoreRepository(seedRepos[0], defaultPreference);

  assert.equal(score.repoId, seedRepos[0].id);
  assert.ok(score.finalScore >= 0 && score.finalScore <= 100);
  assert.ok(score.reasons.length > 0);
}

function verifyRuleAnalysisDifferentiation() {
  const firstRepo = seedRepos[0];
  const secondRepo = seedRepos[3];
  const first = createRuleBasedAnalysis(firstRepo, scoreRepository(firstRepo, defaultPreference), defaultPreference);
  const second = createRuleBasedAnalysis(secondRepo, scoreRepository(secondRepo, defaultPreference), defaultPreference);

  assert.notEqual(first.oneLineSummary, second.oneLineSummary);
  assert.notEqual(first.miniCloneScope.goal, second.miniCloneScope.goal);
  assert.ok(!first.miniCloneScope.coreFeatures.includes("核心输入表单或配置"));
  assert.ok(!first.miniCloneScope.coreFeatures.includes("主处理流程"));
  assert.ok(first.whyLearn.every((reason) => reason.length >= 6));
}

function verifyLegacyRecommendationUpgrade() {
  const current = getRecommendations(defaultPreference)[0];
  const legacy = {
    ...current,
    analysis: {
      ...current.analysis,
      oneLineSummary: `适合围绕 ${current.repo.primaryLanguage} / ai-app 做 mini 复刻，当前规则分 ${current.score.finalScore}。`,
      whyLearn: [`学习雷达分 ${current.score.finalScore}`, "可从 README 和目录结构提炼核心流程"],
      miniCloneScope: {
        goal: `复刻一个 ${current.repo.name} lite，保留最能体现 ${current.repo.primaryLanguage} 和 ai-app 学习价值的核心流程。`,
        coreFeatures: ["核心输入表单或配置", "主处理流程", "结果展示"],
        excludedFeatures: ["原项目的所有高级能力"]
      }
    }
  };
  const upgraded = upgradeLegacyRecommendationContent(legacy, defaultPreference);

  assert.notEqual(upgraded.analysis.oneLineSummary, legacy.analysis.oneLineSummary);
  assert.notEqual(upgraded.analysis.miniCloneScope.goal, legacy.analysis.miniCloneScope.goal);
  assert.ok(!upgraded.analysis.miniCloneScope.coreFeatures.includes("主处理流程"));
  assert.equal(legacy.analysis.miniCloneScope.coreFeatures.includes("主处理流程"), true);
}

function verifyRepositorySignalStates() {
  const base = seedRepos[0];
  const legacyUnknown: RepoSnapshot = {
    ...base,
    readmeExcerpt: "",
    languages: [],
    detectedFiles: [],
    hasTests: false,
    hasExamples: false,
    hasCi: false,
    hasDocker: false,
    enrichment: undefined
  };
  const unknown: RepoSnapshot = {
    ...legacyUnknown,
    enrichment: createUnknownEnrichmentSignals()
  };
  const absent: RepoSnapshot = {
    ...legacyUnknown,
    enrichment: {
      readme: "absent",
      languages: "absent",
      rootFiles: "absent",
      tests: "absent",
      examples: "absent",
      ci: "absent",
      docker: "absent"
    }
  };

  assert.equal(getRepoSignal(legacyUnknown, "tests"), "unknown");
  assert.equal(getRepoSignal({ ...legacyUnknown, hasTests: true }, "tests"), "present");
  assert.equal(normalizeEnrichmentSignals(undefined, legacyUnknown).tests, "unknown");
  assert.equal(getRepoSignal(absent, "tests"), "absent");

  const unknownScore = scoreRepository(unknown, defaultPreference);
  const absentScore = scoreRepository(absent, defaultPreference);
  assert.ok(unknownScore.learningValueScore > absentScore.learningValueScore);
  assert.ok(unknownScore.repoHealthScore > absentScore.repoHealthScore);
  assert.ok(unknownScore.finalScore > absentScore.finalScore);
  assert.ok(unknownScore.reasons.includes("部分工程信号尚未抓取，评分未按缺失处理"));
  assert.equal(unknownScore.risks.some((risk) => risk.includes("未发现测试信号")), false);
  assert.ok(absentScore.risks.some((risk) => risk.includes("未发现测试信号")));

  const badgeMarkup = renderToStaticMarkup(
    createElement(RepositorySignalBadge, { label: "测试", state: "unknown" })
  );
  assert.ok(badgeMarkup.includes("测试 · 未知"));
}

function verifyCandidateServerPagination() {
  const firstPage = paginateRepositoryCandidates(seedRepos, {
    sort: "name",
    page: 1,
    pageSize: 2
  });
  assert.equal(firstPage.sourceTotal, seedRepos.length);
  assert.equal(firstPage.total, seedRepos.length);
  assert.equal(firstPage.items.length, 2);
  assert.ok(firstPage.items[0].fullName.localeCompare(firstPage.items[1].fullName) <= 0);

  const matching = paginateRepositoryCandidates(seedRepos, {
    query: seedRepos[0].fullName,
    category: seedRepos[0].category,
    page: 1,
    pageSize: 12
  });
  assert.ok(matching.total >= 1);
  assert.ok(matching.items.every((repo) => repo.category === seedRepos[0].category));
  assert.ok(matching.items.some((repo) => repo.id === seedRepos[0].id));

  const clamped = paginateRepositoryCandidates(seedRepos, { page: 999, pageSize: 2 });
  assert.equal(clamped.page, clamped.totalPages);
  const empty = paginateRepositoryCandidates(seedRepos, { query: "__no_such_repository__" });
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 1);

  const markup = renderToStaticMarkup(
    createElement(CandidateRepositoryBrowser, {
      ...firstPage,
      query: "",
      category: "all",
      sort: "name"
    })
  );
  assert.ok(markup.includes("筛选与排序在服务端执行"));
  assert.ok(markup.includes("候选项目分页"));
  assert.ok(markup.includes(firstPage.items[0].fullName));
}

function verifyRadarRunProjection() {
  const baseRecommendations = getRecommendations(defaultPreference).slice(0, 2);
  const recommendations = baseRecommendations.map((item, index) => ({
    ...item,
    rank: index + 1,
    analysisTrace: {
      source: index === 0 ? ("ai" as const) : ("rule" as const),
      fallbackReason: index === 0 ? undefined : ("provider-error" as const),
      providerAttempts:
        index === 0
          ? [
              {
                provider: "deepseek" as const,
                modelId: "deepseek-test",
                status: "success" as const,
                usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
              }
            ]
          : []
    }
  }));
  const run: RadarRun = {
    runId: "projection-verification",
    date: "2030-01-01",
    source: "github",
    status: "partial",
    startedAt: "2030-01-01T00:00:00.000Z",
    finishedAt: "2030-01-01T00:01:00.000Z",
    rawCandidateCount: 10,
    recommendationCount: recommendations.length,
    notes: [],
    preference: defaultPreference,
    recommendations
  };
  const projection = createRadarRunProjection(run);
  const repeated = createRadarRunProjection(run);

  assert.equal(projection.scores.length, recommendations.length);
  assert.equal(projection.analyses.length, recommendations.length);
  assert.equal(projection.recommendations.length, recommendations.length);
  assert.equal(projection.scores[0].githubId, recommendations[0].repo.id);
  assert.equal(projection.analyses[0].model, "deepseek-test");
  assert.equal(projection.analyses[0].promptVersion, repositoryAnalysisPromptVersion);
  assert.equal(projection.analyses[0].schemaVersion, repositoryAnalysisSchemaVersion);
  assert.equal(projection.analyses[1].source, "rule");
  assert.equal(projection.recommendations[0].analysisSource, "ai");
  assert.equal(projection.analyses[0].inputHash, repeated.analyses[0].inputHash);

  const changed = createRadarRunProjection({
    ...run,
    recommendations: [
      {
        ...recommendations[0],
        repo: { ...recommendations[0].repo, readmeExcerpt: `${recommendations[0].repo.readmeExcerpt}\nchanged` }
      },
      recommendations[1]
    ]
  });
  assert.notEqual(changed.analyses[0].inputHash, projection.analyses[0].inputHash);
  const changedPreference = createRadarRunProjection({
    ...run,
    preference: { ...defaultPreference, level: "beginner" }
  });
  assert.notEqual(changedPreference.analyses[0].inputHash, projection.analyses[0].inputHash);
  assert.throws(
    () =>
      createRadarRunProjection({
        ...run,
        recommendations: [recommendations[0], { ...recommendations[0], rank: 2 }]
      }),
    /duplicate repository ids or ranks/
  );
  assert.throws(
    () => createRadarRunProjection({ ...run, recommendationCount: recommendations.length + 1 }),
    /recommendation count mismatch/
  );
}

async function verifyProjectionRebuildSkip() {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await rebuildRadarRunProjections();
    assert.equal(result.status, "skipped");
    assert.equal(result.rebuiltRunCount, 0);
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
  }
}

function verifyTopCategory() {
  const recommendations = getRecommendations(defaultPreference);
  const topCategory = getTopCategory(recommendations);

  assert.notEqual(topCategory, "none");
  assert.equal(getRadarStats([]).avgScore, 0);
  assert.equal(getRadarStats([]).topCategory, "none");
}

function verifyRecommendationCardHierarchy() {
  const item = getRecommendations(defaultPreference)[0];
  const startMarkup = renderToStaticMarkup(createElement(RecommendationCard, { item }));
  const continueMarkup = renderToStaticMarkup(
    createElement(RecommendationCard, { item, hasStudyPlan: true })
  );
  const tracedMarkup = renderToStaticMarkup(
    createElement(RecommendationCard, {
      item: {
        ...item,
        analysisTrace: {
          source: "ai",
          providerAttempts: [{ provider: "deepseek", modelId: "test-model", status: "success" }]
        }
      }
    })
  );

  assert.ok(startMarkup.includes("开始学习"));
  assert.ok(continueMarkup.includes("继续学习"));
  assert.ok(startMarkup.includes("为什么推荐"));
  assert.ok(startMarkup.includes("Mini 复刻重点"));
  assert.ok(startMarkup.includes("查看 README 摘录、完整推荐依据与评分"));
  assert.ok(startMarkup.includes("README 清洗摘录"));
  assert.ok(startMarkup.includes(item.analysis.oneLineSummary));
  assert.ok(startMarkup.indexOf("开始学习") < startMarkup.indexOf("查看 README 摘录、完整推荐依据与评分"));
  assert.ok(tracedMarkup.includes("智能分析"));
  assert.equal(tracedMarkup.includes("test-model"), false);
}

function verifyPortfolioOverview() {
  const pendingMarkup = renderToStaticMarkup(createElement(PortfolioOverview, {}));
  const repositoryUrl = "https://github.com/lxy968/github-learning-radar";
  const preparedMarkup = renderToStaticMarkup(createElement(PortfolioOverview, { repositoryUrl }));
  const publishedMarkup = renderToStaticMarkup(
    createElement(PortfolioOverview, { dataSource: "github", repositoryUrl, repositoryPublished: true })
  );
  const requiredContent = [
    "这个项目把公开仓库转成有依据、有范围、有验收标准和进度记录的学习任务",
    "所有人如何在两分钟内体验",
    "从发现仓库到形成学习任务",
    "为什么这样设计",
    "如何防止公开访客消耗 DeepSeek Token",
    "线上作品集版",
    "完整自部署版",
    "开源后如何 Fork、配置自己的 Key 并部署",
    "已完成的测试、CI、数据库和浏览器证据"
  ];

  assert.ok(requiredContent.every((content) => pendingMarkup.includes(content)));
  assert.ok(pendingMarkup.includes("加载内置演示仓库快照"));
  assert.ok(pendingMarkup.includes("开源准备中"));
  assert.equal(pendingMarkup.includes(repositoryUrl), false);
  assert.ok(preparedMarkup.includes("仓库地址已登记"));
  assert.equal(preparedMarkup.includes(repositoryUrl), false);
  assert.ok(publishedMarkup.includes(repositoryUrl));
  assert.ok(publishedMarkup.includes("发现近期活跃仓库"));
  assert.equal(normalizePublicRepositoryUrl(`${repositoryUrl}.git`), repositoryUrl);
  assert.equal(normalizePublicRepositoryUrl("http://github.com/lxy968/github-learning-radar"), undefined);
  assert.equal(normalizePublicRepositoryUrl("javascript:alert(1)"), undefined);
}

function verifyShowcaseStudyPlanFixture() {
  const recommendation = showcaseRecommendation;
  const showcaseEnv = {
    NODE_ENV: "production",
    APP_DEPLOYMENT_MODE: "showcase",
    DEEPSEEK_API_KEY: "must-not-be-used"
  } as NodeJS.ProcessEnv;
  const first = createShowcaseStudyPlan(recommendation, defaultPreference, showcaseEnv);
  const repeated = createShowcaseStudyPlan(recommendation, defaultPreference, showcaseEnv);
  const preparedPlans = listShowcaseStudyPlans([recommendation], defaultPreference, showcaseEnv);

  assert.equal(first.id, repeated.id);
  assert.equal(first.id, "showcase-hermes-agent-3-v1");
  assert.equal(first.duration, 3);
  assert.equal(first.days.length, 3);
  assert.equal(first.generatedThroughDay, 3);
  assert.equal(first.generationStatus, "complete");
  assert.equal(first.source, "ai");
  assert.equal(first.provider, undefined);
  assert.equal(first.providerAttempts?.length, 0);
  assert.equal(first.cache, undefined);
  assert.deepEqual(preparedPlans.map((plan) => plan.duration), [3, 7, 14]);
  assert.deepEqual(preparedPlans.map((plan) => plan.days.length), [3, 7, 14]);
  assert.ok(preparedPlans.every((plan) => plan.source === "ai" && plan.generationStatus === "complete"));
  assert.ok(generatedShowcaseStudyPlans.every((plan) => plan.provider === "deepseek"));
  assert.ok(generatedShowcaseStudyPlans.every((plan) => plan.providerAttempts?.[0]?.status === "success"));
  assert.ok(generatedShowcaseStudyPlans.every((plan) => plan.cache?.modelId === "deepseek-v4-pro"));
  assert.equal(JSON.stringify(preparedPlans).includes("must-not-be-used"), false);
  assert.ok(first.days.every((day) => day.steps.length > 0));
  assert.deepEqual(preparedPlans[0], first);
  assert.deepEqual(listShowcaseStudyPlans([getRecommendations(defaultPreference)[1]], defaultPreference, showcaseEnv), []);
  assert.deepEqual(
    listShowcaseStudyPlans(
      [recommendation],
      defaultPreference,
      { NODE_ENV: "production", APP_DEPLOYMENT_MODE: "full" } as NodeJS.ProcessEnv
    ),
    []
  );
}

function verifyNavigationStructure() {
  assert.deepEqual(
    primaryNavItems.map((item) => item.label),
    ["今日推荐", "我的学习", "收藏", "设置"]
  );
  assert.deepEqual(
    exploreNavItems.map((item) => item.label),
    ["候选项目", "运行历史"]
  );
  assert.equal(isNavItemActive("/", primaryNavItems[0]), true);
  assert.equal(isNavItemActive("/projects/demo/repo/learning-plan", primaryNavItems[1]), true);
  assert.equal(isNavItemActive("/candidates/demo/repo", exploreNavItems[0]), true);
  assert.equal(isNavItemActive("/history", primaryNavItems[1]), false);
}

async function verifySingleMainLandmarkSources() {
  const appShellSource = await fs.readFile(path.join(process.cwd(), "components", "app-shell.tsx"), "utf8");
  const detailSources = await Promise.all([
    fs.readFile(path.join(process.cwd(), "app", "projects", "[owner]", "[repo]", "page.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "app", "candidates", "[owner]", "[repo]", "page.tsx"), "utf8")
  ]);
  assert.equal(appShellSource.match(/<main(?:\s|>)/g)?.length, 1);
  assert.ok(detailSources.every((source) => !/<main(?:\s|>)/.test(source)));
}

function verifyRefreshSchedule() {
  const now = new Date("2026-07-10T00:00:00.000Z").getTime();
  const recentRun = { finishedAt: "2026-07-09T12:00:00.000Z" };
  const oldRun = { finishedAt: "2026-07-08T00:00:00.000Z" };

  assert.equal(getRefreshScheduleDecision(null, "daily", now).shouldRun, true);
  assert.equal(getRefreshScheduleDecision(recentRun, "daily", now).shouldRun, false);
  assert.equal(getRefreshScheduleDecision(oldRun, "daily", now).shouldRun, true);
  assert.equal(getRefreshScheduleDecision(oldRun, "weekly", now).shouldRun, false);
  assert.equal(getRefreshScheduleDecision(oldRun, "never", now).shouldRun, false);
  assert.equal(getRefreshScheduleDecision({ finishedAt: "invalid" }, "daily", now).shouldRun, true);
}

function verifyDynamicDiscoveryWindow() {
  const queries = buildDiscoveryQueries(new Date("2026-07-10T00:00:00.000Z"), 120);

  assert.equal(queries.length, 4);
  assert.ok(queries.every((query) => query.query.includes("pushed:>=2026-03-12")));
  assert.ok(queries.every((query) => !query.query.includes("2026-01-01")));
}

function verifyAdminAuthorization() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAdminSecret = process.env.ADMIN_SECRET;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";

  try {
    delete process.env.ADMIN_SECRET;
    assert.equal(authorizeAdminRequest(new Request("http://localhost")).code, "admin-secret-missing");

    process.env.ADMIN_SECRET = "verification-admin-secret";
    assert.equal(authorizeAdminRequest(new Request("http://localhost")).code, "unauthorized");
    assert.equal(
      authorizeAdminRequest(
        new Request("http://localhost", { headers: { Authorization: "Bearer verification-admin-secret" } })
      ).authorized,
      true
    );
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("ADMIN_SECRET", previousAdminSecret);
  }
}

function verifyOperationalErrorClassification() {
  const rateLimit = classifyOperationalError(
    { statusCode: 429, message: "rate limit", responseHeaders: { "retry-after": "2" } },
    { system: "github" }
  );
  assert.equal(rateLimit.category, "github_rate_limit");
  assert.equal(rateLimit.retryable, true);
  assert.equal(rateLimit.retryAfterMs, 2_000);
  assert.equal(getRetryDelayMs(1, rateLimit), 5_000);

  const quota = classifyOperationalError(new Error("insufficient quota / balance"), { system: "ai" });
  assert.equal(quota.category, "ai_quota");
  assert.equal(quota.retryable, false);

  const auth = classifyOperationalError({ statusCode: 401, message: "invalid API key" }, { system: "ai" });
  assert.equal(auth.category, "ai_auth");
  assert.equal(auth.retryable, false);

  const database = classifyOperationalError({ code: "ECONNREFUSED", message: "database unavailable" });
  assert.equal(database.category, "database_network");
  assert.equal(database.retryable, true);
}

function verifyAnonymousSessionIdentity() {
  const issuedAt = new Date("2030-01-01T00:00:00.000Z");
  const firstToken = createAnonymousSessionToken(issuedAt);
  const secondToken = createAnonymousSessionToken(issuedAt);
  const firstUserId = deriveAnonymousUserId(firstToken, issuedAt);
  const secondUserId = deriveAnonymousUserId(secondToken, issuedAt);

  assert.match(firstToken, /^v1\.[0-9a-z]{1,10}\.[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstToken, secondToken);
  assert.match(firstUserId ?? "", /^anon_[a-f0-9]{64}$/);
  assert.notEqual(firstUserId, secondUserId);
  assert.equal(firstUserId?.includes(firstToken), false);
  assert.equal(deriveAnonymousUserId("predictable-session", issuedAt), null);
  assert.equal(
    deriveAnonymousUserId(
      firstToken,
      new Date(issuedAt.getTime() + anonymousSessionMaxAgeSeconds * 1_000 + 1)
    ),
    null
  );
}

async function verifyOperationalRetry() {
  let calls = 0;
  const delays: number[] = [];
  const result = await withOperationalRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw { statusCode: 503, message: "GitHub unavailable" };
      return "ok";
    },
    {
      system: "github",
      maxAttempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 20,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [20]);
}

async function verifyAnonymousUserIsolation() {
  const previousPreferenceStore = process.env.PREFERENCE_STORE_FILE;
  const previousUserStateStore = process.env.USER_STATE_STORE_FILE;
  const previousSessionStore = process.env.ANONYMOUS_SESSION_STORE_FILE;
  const previousProgressStore = process.env.LEARNING_PROGRESS_STORE_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const prefix = path.join(os.tmpdir(), `learning-radar-session-${process.pid}-${Date.now()}`);
  const files = [
    `${prefix}-preferences.json`,
    `${prefix}-state.json`,
    `${prefix}-sessions.json`,
    `${prefix}-progress.json`
  ];
  process.env.PREFERENCE_STORE_FILE = files[0];
  process.env.USER_STATE_STORE_FILE = files[1];
  process.env.ANONYMOUS_SESSION_STORE_FILE = files[2];
  process.env.LEARNING_PROGRESS_STORE_FILE = files[3];
  delete process.env.DATABASE_URL;

  try {
    const firstToken = createAnonymousSessionToken();
    const secondToken = createAnonymousSessionToken();
    const firstUserId = deriveAnonymousUserId(firstToken);
    const secondUserId = deriveAnonymousUserId(secondToken);
    assert.ok(firstUserId && secondUserId);

    const sessions = await import("../lib/anonymous-session-store");
    const preferences = await import("../lib/preferences");
    const userState = await import("../lib/user-state");
    const progress = await import("../lib/learning-progress");
    const userData = await import("../lib/user-data");
    const registeredAt = new Date();
    const expiresAt = new Date(registeredAt.getTime() + anonymousSessionMaxAgeSeconds * 1_000);
    await sessions.registerAnonymousSession(firstUserId, expiresAt, registeredAt);
    await sessions.registerAnonymousSession(secondUserId, expiresAt, registeredAt);

    const firstPreference = { ...defaultPreference, languages: ["Rust"], goal: "source-reading" as const };
    await preferences.saveUserPreference(firstPreference, firstUserId);
    assert.deepEqual((await preferences.getUserPreference(firstUserId)).languages, ["Rust"]);
    assert.deepEqual((await preferences.getUserPreference(secondUserId)).languages, defaultPreference.languages);

    const repoId = seedRepos[0].id;
    await userState.recordFeedback(firstUserId, { repoId, eventType: "want_to_learn", value: true });
    assert.equal((await userState.getInteraction(firstUserId, repoId)).wantToLearn, true);
    assert.equal((await userState.getInteraction(secondUserId, repoId)).wantToLearn, false);

    const feedbackRoute = await import("../app/api/feedback/route");
    const maliciousResponse = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: JSON.stringify({ repoId, eventType: "bookmarked", value: true, userId: firstUserId })
      })
    );
    const maliciousPayload = (await maliciousResponse.json()) as {
      event?: { userId?: string };
      interaction?: { bookmarked?: boolean };
    };
    assert.equal(maliciousResponse.status, 400);
    assert.equal(maliciousPayload.interaction?.bookmarked, undefined);
    assert.equal((await userState.getInteraction(firstUserId, repoId)).bookmarked, false);

    const validFeedbackResponse = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: JSON.stringify({ repoId, eventType: "bookmarked", value: true })
      })
    );
    const validFeedbackPayload = (await validFeedbackResponse.json()) as {
      event?: { userId?: string; payload?: unknown };
    };
    assert.equal(validFeedbackResponse.status, 201);
    assert.equal("userId" in (validFeedbackPayload.event ?? {}), false);
    assert.equal("payload" in (validFeedbackPayload.event ?? {}), false);
    assert.equal((await userState.getInteraction(secondUserId, repoId)).bookmarked, true);

    const arbitraryPayloadResponse = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: JSON.stringify({ repoId, eventType: "bookmarked", value: true, payload: { note: "not allowed" } })
      })
    );
    assert.equal(arbitraryPayloadResponse.status, 400);

    const makeFeedbackBody = (size: number) => {
      const template = JSON.stringify({ repoId, eventType: "bookmarked", value: true, padding: "" });
      assert.ok(template.length <= size);
      return template.replace(/""}$/, `"${"x".repeat(size - template.length)}"}`);
    };
    const boundaryFeedbackResponse = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: makeFeedbackBody(2_048)
      })
    );
    assert.equal(boundaryFeedbackResponse.status, 400);
    const oversizedFeedbackResponse = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: makeFeedbackBody(2_049)
      })
    );
    assert.equal(oversizedFeedbackResponse.status, 413);

    const invalidMediaTypeResponse = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json-malformed",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: JSON.stringify({ repoId, eventType: "bookmarked", value: true })
      })
    );
    assert.equal(invalidMediaTypeResponse.status, 415);

    const invalidUtf8Response = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: new Uint8Array([0xff])
      })
    );
    assert.equal(invalidUtf8Response.status, 400);

    const failedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("verification stream failure"));
      }
    });
    const failedBodyResponse = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: failedBody,
        duplex: "half"
      } as RequestInit & { duplex: "half" })
    );
    assert.equal(failedBodyResponse.status, 400);

    const preferencesRoute = await import("../app/api/preferences/route");
    const preferenceResponse = await preferencesRoute.PUT(
      new Request("http://localhost/api/preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: JSON.stringify({ ...defaultPreference, languages: ["Go"], userId: firstUserId })
      })
    );
    assert.equal(preferenceResponse.status, 200);
    assert.deepEqual((await preferences.getUserPreference(firstUserId)).languages, ["Rust"]);
    assert.deepEqual((await preferences.getUserPreference(secondUserId)).languages, ["Go"]);

    await progress.mergeLearningProgress(firstUserId, "detailed:verify-plan", [
      { stepId: "step-1", completed: true, updatedAt: "2030-01-01T00:02:00.000Z" }
    ], new Date("2030-01-01T00:02:00.000Z"));
    await progress.mergeLearningProgress(firstUserId, "detailed:verify-plan", [
      { stepId: "step-1", completed: false, updatedAt: "2030-01-01T00:01:00.000Z" }
    ], new Date("2030-01-01T00:03:00.000Z"));
    assert.equal((await progress.getLearningProgress(firstUserId, "detailed:verify-plan"))[0]?.completed, true);

    const progressRoute = await import("../app/api/progress/route");
    const progressResponse = await progressRoute.PUT(
      new Request("http://localhost/api/progress", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: JSON.stringify({
          planId: "detailed:verify-plan",
          userId: firstUserId,
          updates: [{ stepId: "step-1", completed: false, updatedAt: "2030-01-01T00:04:00.000Z" }]
        })
      })
    );
    assert.equal(progressResponse.status, 200);
    assert.equal((await progress.getLearningProgress(firstUserId, "detailed:verify-plan"))[0]?.completed, true);
    assert.equal((await progress.getLearningProgress(secondUserId, "detailed:verify-plan"))[0]?.completed, false);

    const expiredIssuedAt = new Date(Date.now() - anonymousSessionMaxAgeSeconds * 2_000);
    const expiredToken = createAnonymousSessionToken(expiredIssuedAt);
    const expiredUserId = deriveAnonymousUserId(expiredToken, expiredIssuedAt);
    assert.ok(expiredUserId);
    await sessions.registerAnonymousSession(
      expiredUserId,
      new Date(expiredIssuedAt.getTime() + anonymousSessionMaxAgeSeconds * 1_000),
      expiredIssuedAt
    );
    await preferences.saveUserPreference({ ...defaultPreference, languages: ["Python"] }, expiredUserId);
    await userState.recordFeedback(expiredUserId, { repoId, eventType: "want_to_learn", value: true });
    await progress.mergeLearningProgress(expiredUserId, "detailed:expired-plan", [
      { stepId: "expired-step", completed: true, updatedAt: "2028-01-01T00:00:00.000Z" }
    ]);

    const expiredUserIds = [expiredUserId];
    for (let index = 1; index < 25; index += 1) {
      const token = createAnonymousSessionToken(expiredIssuedAt);
      const userId = deriveAnonymousUserId(token, expiredIssuedAt);
      assert.ok(userId);
      await sessions.registerAnonymousSession(
        userId,
        new Date(expiredIssuedAt.getTime() + anonymousSessionMaxAgeSeconds * 1_000),
        expiredIssuedAt
      );
      expiredUserIds.push(userId);
    }

    const cleanup = await userData.cleanupExpiredAnonymousUserData(new Date(), 10, 4);
    assert.equal(cleanup.storage, "local-json");
    assert.equal(cleanup.batches, 3);
    assert.deepEqual(new Set(cleanup.deletedUserIds), new Set(expiredUserIds));
    assert.deepEqual((await preferences.getUserPreference(expiredUserId)).languages, defaultPreference.languages);
    assert.equal((await userState.getInteraction(expiredUserId, repoId)).wantToLearn, false);
    assert.equal((await progress.getLearningProgress(expiredUserId, "detailed:expired-plan")).length, 0);
    assert.equal((await userState.getInteraction(firstUserId, repoId)).wantToLearn, true);
    const remainingSessions = JSON.parse(await fs.readFile(files[2], "utf8")) as {
      sessions?: Record<string, unknown>;
    };
    assert.equal(firstUserId in (remainingSessions.sessions ?? {}), true);
    assert.equal(secondUserId in (remainingSessions.sessions ?? {}), true);

    const sessionRoute = await import("../app/api/session/route");
    const deleteResponse = await sessionRoute.DELETE(
      new Request("http://localhost/api/session", {
        method: "DELETE",
        headers: { Cookie: `${anonymousSessionCookieName}=${secondToken}` }
      })
    );
    assert.equal(deleteResponse.status, 200);
    assert.match(deleteResponse.headers.get("set-cookie") ?? "", /glr_session=/);
    assert.equal((await userState.getInteraction(secondUserId, repoId)).bookmarked, false);
    assert.equal((await progress.getLearningProgress(secondUserId, "detailed:verify-plan")).length, 0);
    assert.equal((await userState.getInteraction(firstUserId, repoId)).wantToLearn, true);
    assert.equal((await progress.getLearningProgress(firstUserId, "detailed:verify-plan"))[0]?.completed, true);

    const replayedDeletedSession = await feedbackRoute.POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${anonymousSessionCookieName}=${secondToken}`
        },
        body: JSON.stringify({ repoId, eventType: "bookmarked", value: true })
      })
    );
    assert.equal(replayedDeletedSession.status, 401);
  } finally {
    await Promise.all(files.map((file) => fs.rm(file, { force: true })));
    restoreEnv("PREFERENCE_STORE_FILE", previousPreferenceStore);
    restoreEnv("USER_STATE_STORE_FILE", previousUserStateStore);
    restoreEnv("ANONYMOUS_SESSION_STORE_FILE", previousSessionStore);
    restoreEnv("LEARNING_PROGRESS_STORE_FILE", previousProgressStore);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
  }
}

async function verifySessionProxyCookie() {
  const previousSessionStore = process.env.ANONYMOUS_SESSION_STORE_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const sessionStore = path.join(os.tmpdir(), `learning-radar-proxy-session-${process.pid}-${Date.now()}.json`);
  process.env.ANONYMOUS_SESSION_STORE_FILE = sessionStore;
  delete process.env.DATABASE_URL;
  const { NextRequest } = await import("next/server");
  const { proxy } = await import("../proxy");
  try {
    const response = await proxy(new NextRequest("http://localhost/settings"));
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /glr_session=v1\.[0-9a-z]{1,10}\.[A-Za-z0-9_-]{43}/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Max-Age=31536000/i);
    const stored = JSON.parse(await fs.readFile(sessionStore, "utf8")) as { sessions?: Record<string, unknown> };
    assert.equal(Object.keys(stored.sessions ?? {}).length, 1);
  } finally {
    await fs.rm(sessionStore, { force: true });
    restoreEnv("ANONYMOUS_SESSION_STORE_FILE", previousSessionStore);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
  }
}

function verifyReadmeSanitizer() {
  const raw =
    '<h1 align="center"><a href="https://example.com"><img alt="Orca" src="icon.png" /> Orca</a></h1><p>Run agents side-by-side.</p>';
  const sanitized = sanitizeReadmeExcerpt(raw);

  assert.ok(sanitized.includes("Orca"));
  assert.ok(sanitized.includes("Run agents side-by-side."));
  assert.ok(!sanitized.includes("<"));
  assert.ok(!sanitized.includes("href="));

  const legacyBrokenHtml =
    '<h1 align="center" <a href="https://example.com" <img src="icon.png" alt="Orca" width="64" / </a Orca </h1 <strong The AI Orchestrator.</strong <br/ Run agents.';
  const cleanedLegacy = sanitizeReadmeExcerpt(legacyBrokenHtml);

  assert.ok(cleanedLegacy.includes("Orca"));
  assert.ok(cleanedLegacy.includes("The AI Orchestrator."));
  assert.ok(cleanedLegacy.includes("Run agents."));
  assert.ok(!cleanedLegacy.includes("<"));
  assert.ok(!cleanedLegacy.includes("href="));

  const badgeHeavy =
    "# Genie React\n[![npm version](https://img.shields.io/npm/v/genie-react.svg)](https://www.npmjs.com/package/genie-react)\nhttps://img.shields.io/npm/dm/genie-react.svg\nGenerate React components from a short instruction.";
  const cleanedBadgeHeavy = sanitizeReadmeExcerpt(badgeHeavy);
  assert.ok(cleanedBadgeHeavy.includes("Genie React"));
  assert.ok(cleanedBadgeHeavy.includes("Generate React components"));
  assert.ok(!cleanedBadgeHeavy.includes("npm version"));
  assert.ok(!cleanedBadgeHeavy.includes("https://"));
  assert.ok(!cleanedBadgeHeavy.includes("img.shields.io"));
}

function verifyUniqueTextValues() {
  assert.deepEqual(uniqueTextValues(["风险 A", " 风险 A ", "", "风险 B", "风险 B"]), ["风险 A", "风险 B"]);
}

function verifyRuleBasedDetailedStudyPlan() {
  const recommendation = getRecommendations(defaultPreference)[0];
  const plan3Days = createRuleBasedDetailedStudyPlan(recommendation, 3);
  const plan14Days = createRuleBasedDetailedStudyPlan(recommendation, 14);
  const steps = plan3Days.days.flatMap((day) => day.steps);

  assert.equal(plan3Days.days.length, 3);
  assert.equal(plan3Days.generationStatus, "complete");
  assert.equal(plan14Days.days.length, 14);
  assert.equal(plan14Days.generatedThroughDay, 14);
  assert.equal(plan14Days.generationStatus, "complete");
  assert.ok((plan14Days.glossary?.length ?? 0) > 0);
  assert.ok(steps.every((step) => step.actions.length >= 2));
  assert.ok(steps.every((step) => step.references.length >= 1));
  assert.ok(steps.every((step) => step.verification.length > 4));
  assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
  assert.equal(getDetailedStudyPlanSteps(plan3Days).length, steps.length);
  assert.equal(getDetailedStudyPlanStorageKey(plan3Days.id), `detailed-study-plan:${plan3Days.id}`);
}

function verifyDetailedStudyPlanModelOutputRecovery() {
  const parsed = parseDetailedStudyPlanModelJson(
    '下面是结果：\n```json\n{"summary":"完整方案","prerequisites":["A","B"],"glossary":[],"days":[]}\n```\n请查收。'
  ) as { summary?: string };
  assert.equal(parsed.summary, "完整方案");
  assert.throws(() => parseDetailedStudyPlanModelJson('{"summary":"被截断"'), /可能被截断/);

  const normalized = normalizeDetailedStudyPlanModelContent(
    {
      summary: "摘要",
      prerequisites: Array.from({ length: 10 }, (_, index) => `准备 ${index + 1}`),
      glossary: Array.from({ length: 8 }, (_, index) => ({ term: `术语 ${index + 1}`, explanation: "解释" })),
      days: [
        {
          day: "1",
          goal: "目标",
          outcome: "结果",
          steps: Array.from({ length: 5 }, () => ({
            title: "步骤",
            purpose: "目的",
            actions: ["操作一", "操作二"],
            references: ["README.md"],
            verification: "完成验证",
            deliverable: "交付物",
            estimatedMinutes: "60"
          }))
        }
      ]
    },
    1,
    1
  ) as { prerequisites: unknown[]; glossary: unknown[]; days: Array<{ day: number; steps: unknown[] }> };
  assert.equal(normalized.prerequisites.length, 8);
  assert.equal(normalized.glossary.length, 6);
  assert.equal(normalized.days[0].day, 1);
  assert.equal(normalized.days[0].steps.length, 4);
}

function verifyLearnerCommunicationGuidance() {
  const beginner = getLearnerCommunicationGuidance("beginner").join(" ");
  const intermediate = getLearnerCommunicationGuidance("intermediate").join(" ");
  const advanced = getLearnerCommunicationGuidance("advanced").join(" ");

  assert.ok(beginner.includes("日常语言"));
  assert.ok(beginner.includes("首次出现"));
  assert.ok(intermediate.includes("容易理解"));
  assert.ok(intermediate.includes("白话解释"));
  assert.ok(advanced.includes("工程术语"));
  assert.equal(shouldIncludeLearnerGlossary("beginner"), true);
  assert.equal(shouldIncludeLearnerGlossary("intermediate"), true);
  assert.equal(shouldIncludeLearnerGlossary("advanced"), false);
}

function verifyDetailedStudyPlanCacheIdentity() {
  const recommendation = getRecommendations(defaultPreference)[0];
  const baseEnv = { ...process.env, DEEPSEEK_API_KEY: "", DEEPSEEK_MODEL: "" };
  const base = buildDetailedStudyPlanCacheMetadata(recommendation, 7, defaultPreference, baseEnv);
  const repeated = buildDetailedStudyPlanCacheMetadata(recommendation, 7, defaultPreference, baseEnv);
  const changedLevel = buildDetailedStudyPlanCacheMetadata(
    recommendation,
    7,
    { ...defaultPreference, level: "beginner" },
    baseEnv
  );
  const changedGoal = buildDetailedStudyPlanCacheMetadata(
    recommendation,
    7,
    { ...defaultPreference, goal: "portfolio" },
    baseEnv
  );
  const changedInput = buildDetailedStudyPlanCacheMetadata(
    {
      ...recommendation,
      repo: { ...recommendation.repo, readmeExcerpt: `${recommendation.repo.readmeExcerpt}\nchanged` }
    },
    7,
    defaultPreference,
    baseEnv
  );
  const reorderedSignals = buildDetailedStudyPlanCacheMetadata(
    {
      ...recommendation,
      repo: {
        ...recommendation.repo,
        topics: [...recommendation.repo.topics].reverse(),
        languages: [...recommendation.repo.languages].reverse(),
        detectedFiles: [...recommendation.repo.detectedFiles].reverse(),
        dependencies: [...recommendation.repo.dependencies].reverse()
      }
    },
    7,
    defaultPreference,
    baseEnv
  );
  const deepSeek = buildDetailedStudyPlanCacheMetadata(recommendation, 7, defaultPreference, {
    ...process.env,
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_PRO_MODEL: "deepseek-test"
  });

  assert.equal(base.key, repeated.key);
  assert.equal(base.inputHash, repeated.inputHash);
  assert.equal(base.promptVersion, detailedStudyPlanPromptVersion);
  assert.equal(base.schemaVersion, detailedStudyPlanSchemaVersion);
  assert.equal(base.provider, "deepseek");
  assert.equal(base.modelId, "deepseek-v4-pro");
  assert.notEqual(base.key, changedLevel.key);
  assert.equal(base.inputHash, changedLevel.inputHash);
  assert.notEqual(base.key, changedGoal.key);
  assert.equal(base.inputHash, changedGoal.inputHash);
  assert.notEqual(base.inputHash, changedInput.inputHash);
  assert.notEqual(base.key, changedInput.key);
  assert.equal(base.inputHash, reorderedSignals.inputHash);
  assert.equal(base.key, reorderedSignals.key);
  assert.equal(deepSeek.provider, "deepseek");
  assert.equal(deepSeek.modelId, "deepseek-test");
  assert.equal(deepSeek.inputHash, base.inputHash);
  assert.notEqual(deepSeek.key, base.key);

  const beginnerContext = createDetailedStudyPlanGenerationContext(
    recommendation,
    3,
    { level: "beginner", goal: "portfolio" },
    baseEnv
  );
  const beginnerPlan = createRuleBasedDetailedStudyPlan(recommendation, 3, beginnerContext);
  assert.equal(beginnerPlan.cache?.key, beginnerContext.cache.key);
  assert.ok(beginnerPlan.summary.includes("入门水平"));
  assert.ok(beginnerPlan.summary.includes("作品集交付"));
}

async function verifyDetailedStudyPlanCachePersistence() {
  const previousStoreFile = process.env.DETAILED_STUDY_PLAN_STORE_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const temporaryFile = path.join(os.tmpdir(), `learning-radar-detailed-plans-${process.pid}-${Date.now()}.json`);
  process.env.DETAILED_STUDY_PLAN_STORE_FILE = temporaryFile;
  delete process.env.DATABASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  const recommendation = getRecommendations(defaultPreference)[0];
  let generationCount = 0;
  const generate = async (
    item: typeof recommendation,
    duration: 3 | 7 | 14,
    context: ReturnType<typeof createDetailedStudyPlanGenerationContext>
  ) => {
    generationCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return createRuleBasedDetailedStudyPlan(item, duration, context);
  };

  try {
    await fs.writeFile(
      temporaryFile,
      `${JSON.stringify({ plans: [{ ...createRuleBasedDetailedStudyPlan(recommendation, 3), cache: undefined }] })}\n`,
      "utf8"
    );
    const first = await getOrCreateDetailedStudyPlan(recommendation, 3, {
      preference: defaultPreference,
      generate
    });
    const repeated = await getOrCreateDetailedStudyPlan(recommendation, 3, {
      preference: defaultPreference,
      generate
    });
    assert.equal(first.cached, false);
    assert.equal(repeated.cached, true);
    assert.equal(generationCount, 1);
    assert.equal(first.plan.cache?.key, repeated.plan.cache?.key);

    const changedPreference = { ...defaultPreference, goal: "portfolio" as const };
    const changed = await getOrCreateDetailedStudyPlan(recommendation, 3, {
      preference: changedPreference,
      generate
    });
    assert.equal(changed.cached, false);
    assert.notEqual(changed.plan.cache?.key, first.plan.cache?.key);
    assert.equal(generationCount, 2);

    const changedRecommendation = {
      ...recommendation,
      repo: { ...recommendation.repo, readmeExcerpt: `${recommendation.repo.readmeExcerpt}\nnew evidence` }
    };
    const changedInput = await getOrCreateDetailedStudyPlan(changedRecommendation, 3, {
      preference: defaultPreference,
      generate
    });
    assert.equal(changedInput.cached, false);
    assert.notEqual(changedInput.plan.cache?.inputHash, first.plan.cache?.inputHash);
    assert.equal(generationCount, 3);

    const concurrentBefore = generationCount;
    const concurrent = await Promise.all([
      getOrCreateDetailedStudyPlan(recommendation, 7, { preference: defaultPreference, force: true, generate }),
      getOrCreateDetailedStudyPlan(recommendation, 7, { preference: defaultPreference, force: true, generate })
    ]);
    assert.equal(generationCount, concurrentBefore + 1);
    assert.equal(concurrent[0].plan.id, concurrent[1].plan.id);

    const complete14Days = await getOrCreateDetailedStudyPlan(recommendation, 14, {
      preference: defaultPreference,
      force: true,
      generate
    });
    assert.equal(complete14Days.plan.generatedThroughDay, 14);
    assert.equal(complete14Days.plan.days.length, 14);
    assert.equal(complete14Days.plan.generationStatus, "complete");

    const currentDefault = await listCurrentDetailedStudyPlans([recommendation], defaultPreference);
    const currentPortfolio = await listCurrentDetailedStudyPlans([recommendation], changedPreference);
    assert.ok(currentDefault.some((plan) => plan.cache?.key === first.plan.cache?.key));
    assert.ok(currentPortfolio.some((plan) => plan.cache?.key === changed.plan.cache?.key));
    assert.equal(currentDefault.some((plan) => plan.cache?.key === changed.plan.cache?.key), false);
    assert.equal((await listDetailedStudyPlans(recommendation.repo.id)).some((plan) => !plan.cache), true);
  } finally {
    await fs.rm(temporaryFile, { force: true });
    restoreEnv("DETAILED_STUDY_PLAN_STORE_FILE", previousStoreFile);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("DEEPSEEK_API_KEY", previousDeepSeekKey);
  }
}

async function verifyStudyPlanBackgroundJobs() {
  const previousJobStore = process.env.JOB_RUN_STORE_FILE;
  const previousPlanStore = process.env.DETAILED_STUDY_PLAN_STORE_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const previousSessionStore = process.env.ANONYMOUS_SESSION_STORE_FILE;
  const suffix = `${process.pid}-${Date.now()}`;
  const jobStore = path.join(os.tmpdir(), `learning-radar-study-jobs-${suffix}.json`);
  const planStore = path.join(os.tmpdir(), `learning-radar-study-plans-${suffix}.json`);
  const sessionStore = path.join(os.tmpdir(), `learning-radar-study-sessions-${suffix}.json`);
  process.env.JOB_RUN_STORE_FILE = jobStore;
  process.env.DETAILED_STUDY_PLAN_STORE_FILE = planStore;
  process.env.ANONYMOUS_SESSION_STORE_FILE = sessionStore;
  delete process.env.DATABASE_URL;
  delete process.env.DEEPSEEK_API_KEY;

  const recommendation = getRecommendations(defaultPreference)[0];
  const ownerToken = createAnonymousSessionToken();
  const otherToken = createAnonymousSessionToken();
  const ownerUserId = deriveAnonymousUserId(ownerToken);
  assert.ok(ownerUserId);
  const payloadBase = {
    userId: ownerUserId,
    owner: recommendation.repo.owner,
    repo: recommendation.repo.name,
    repoFullName: recommendation.repo.fullName,
    force: true,
    preference: { level: defaultPreference.level, goal: defaultPreference.goal }
  } as const;
  let initialCalls = 0;

  try {
    const sessions = await import("../lib/anonymous-session-store");
    const registeredAt = new Date();
    const expiresAt = new Date(registeredAt.getTime() + anonymousSessionMaxAgeSeconds * 1_000);
    const otherUserId = deriveAnonymousUserId(otherToken);
    assert.ok(otherUserId);
    await sessions.registerAnonymousSession(ownerUserId, expiresAt, registeredAt);
    await sessions.registerAnonymousSession(otherUserId, expiresAt, registeredAt);
    const concurrent = await Promise.all([
      enqueueDetailedStudyPlanJob({ ...payloadBase, duration: 7 }),
      enqueueDetailedStudyPlanJob({ ...payloadBase, duration: 14 })
    ]);
    assert.equal(concurrent.filter((item) => item.created).length, 1);
    assert.equal(concurrent[0].job.runId, concurrent[1].job.runId);
    assert.equal(initialCalls, 0, "Enqueue must return before the slow generator starts.");

    const { GET: getJobStatus } = await import("../app/api/jobs/[runId]/route");
    const routeContext = { params: Promise.resolve({ runId: concurrent[0].job.runId }) };
    const noSessionResponse = await getJobStatus(
      new Request(`http://localhost/api/jobs/${encodeURIComponent(concurrent[0].job.runId)}`),
      routeContext
    );
    assert.equal(noSessionResponse.status, 404);
    const otherSessionResponse = await getJobStatus(
      new Request(`http://localhost/api/jobs/${encodeURIComponent(concurrent[0].job.runId)}`, {
        headers: { Cookie: `${anonymousSessionCookieName}=${otherToken}` }
      }),
      routeContext
    );
    assert.equal(otherSessionResponse.status, 404);
    const ownerSessionResponse = await getJobStatus(
      new Request(`http://localhost/api/jobs/${encodeURIComponent(concurrent[0].job.runId)}`, {
        headers: { Cookie: `${anonymousSessionCookieName}=${ownerToken}` }
      }),
      routeContext
    );
    assert.equal(ownerSessionResponse.status, 200);

    const executed = await executeDetailedStudyPlanJob(concurrent[0].job.runId, {
      loadRecommendation: async () => recommendation,
      generateInitial: async (item, duration, context) => {
        initialCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return createRuleBasedDetailedStudyPlan(item, duration, context);
      },
      heartbeatIntervalMs: 5
    });
    assert.equal(executed.status, "success");
    assert.deepEqual(executed.progress, { completed: 7, total: 7 });
    assert.equal(executed.summary.generatedThroughDay, 7);
    assert.equal(initialCalls, 1);
    const storedPlan = (await listDetailedStudyPlans(recommendation.repo.id)).find((plan) => plan.duration === 7);
    assert.equal(storedPlan?.days.length, 7);
    assert.equal(storedPlan?.generationStatus, "complete");

    const next = await enqueueDetailedStudyPlanJob({ ...payloadBase, duration: 14 });
    assert.equal(next.created, true);
    let releaseGeneration: () => void = () => {};
    let signalStarted: () => void = () => {};
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const generationStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
    const runningExecution = executeDetailedStudyPlanJob(next.job.runId, {
      loadRecommendation: async () => recommendation,
      generateInitial: async (item, duration, context) => {
        signalStarted();
        await generationGate;
        return createRuleBasedDetailedStudyPlan(item, duration, context);
      }
    });
    await generationStarted;
    const blockedByRunningStage = await enqueueDetailedStudyPlanJob({ ...payloadBase, duration: 3 });
    assert.equal(blockedByRunningStage.created, false);
    assert.equal(blockedByRunningStage.job.runId, next.job.runId);
    releaseGeneration();
    assert.equal((await runningExecution).status, "success");

    const afterCompletion = await enqueueDetailedStudyPlanJob({ ...payloadBase, duration: 3 });
    assert.equal(afterCompletion.created, true);
  } finally {
    await fs.rm(jobStore, { force: true });
    await fs.rm(planStore, { force: true });
    await fs.rm(sessionStore, { force: true });
    restoreEnv("JOB_RUN_STORE_FILE", previousJobStore);
    restoreEnv("DETAILED_STUDY_PLAN_STORE_FILE", previousPlanStore);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("DEEPSEEK_API_KEY", previousDeepSeekKey);
    restoreEnv("ANONYMOUS_SESSION_STORE_FILE", previousSessionStore);
  }
}

async function verifyDetailedPlanFocusMode() {
  const recommendation = getRecommendations(defaultPreference)[0];
  const plan = createRuleBasedDetailedStudyPlan(recommendation, 3);
  const markup = renderToStaticMarkup(
    createElement(DetailedStudyPlanBuilder, {
      owner: recommendation.repo.owner,
      repo: recommendation.repo.name,
      projectName: recommendation.repo.fullName,
      language: recommendation.repo.primaryLanguage,
      cloneGoal: recommendation.analysis.miniCloneScope.goal,
      learnerLevel: defaultPreference.level,
      learnerGoal: defaultPreference.goal,
      initialPlans: [plan]
    })
  );

  assert.ok(markup.includes("总进度"));
  assert.ok(markup.includes("当前任务"));
  assert.ok(markup.includes("完成并进入下一步"));
  assert.ok(markup.includes('role="progressbar"'));
  assert.ok(markup.includes("匿名会话已同步") || markup.includes("正在同步进度"));
  assert.equal((markup.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-expanded="false"/g) ?? []).length, plan.days.length - 1);
  assert.ok(markup.includes(plan.days[0].steps[0].title));
  assert.equal(markup.includes(plan.days[1].steps[0].title), false);
  assert.ok(markup.includes("h-11 w-11"));
  assert.ok(markup.includes("缓存版本"));
  assert.ok(markup.includes(detailedStudyPlanPromptVersion));

  const completeRulePlan = createRuleBasedDetailedStudyPlan(recommendation, 14);
  const completeRuleMarkup = renderToStaticMarkup(
    createElement(DetailedStudyPlanBuilder, {
      owner: recommendation.repo.owner,
      repo: recommendation.repo.name,
      projectName: recommendation.repo.fullName,
      language: recommendation.repo.primaryLanguage,
      cloneGoal: recommendation.analysis.miniCloneScope.goal,
      learnerLevel: defaultPreference.level,
      learnerGoal: defaultPreference.goal,
      initialPlans: [completeRulePlan]
    })
  );
  assert.ok(completeRuleMarkup.includes("临时规则方案"));
  assert.ok(completeRuleMarkup.includes("完整方案"));
  assert.ok(completeRuleMarkup.includes("已有方案可用"));
  assert.ok(completeRuleMarkup.includes("一次生成完整方案"));
  assert.ok(completeRuleMarkup.includes("3 天"));
  assert.ok(completeRuleMarkup.includes("7 天"));
  assert.ok(completeRuleMarkup.includes("14 天"));
  assert.ok(completeRuleMarkup.includes("术语白话解释"));

  const showcaseMarkup = renderToStaticMarkup(
    createElement(DetailedStudyPlanBuilder, {
      owner: recommendation.repo.owner,
      repo: recommendation.repo.name,
      projectName: recommendation.repo.fullName,
      language: recommendation.repo.primaryLanguage,
      cloneGoal: recommendation.analysis.miniCloneScope.goal,
      learnerLevel: defaultPreference.level,
      learnerGoal: defaultPreference.goal,
      initialPlans: [plan],
      showcaseMode: true
    })
  );
  assert.ok(showcaseMarkup.includes("作品集预置体验"));
  assert.ok(showcaseMarkup.includes("不会现场调用模型"));
  assert.ok(showcaseMarkup.includes("不会产生模型费用"));
  assert.ok(showcaseMarkup.includes("DeepSeek 真实生成缓存"));
  assert.equal(showcaseMarkup.includes("开始后台生成"), false);
  assert.equal(showcaseMarkup.includes("重新生成"), false);

  const emptyShowcaseMarkup = renderToStaticMarkup(
    createElement(DetailedStudyPlanBuilder, {
      owner: recommendation.repo.owner,
      repo: recommendation.repo.name,
      projectName: recommendation.repo.fullName,
      language: recommendation.repo.primaryLanguage,
      cloneGoal: recommendation.analysis.miniCloneScope.goal,
      learnerLevel: defaultPreference.level,
      learnerGoal: defaultPreference.goal,
      initialPlans: [],
      showcaseMode: true
    })
  );
  assert.ok(emptyShowcaseMarkup.includes("公开演示方案正在准备中"));
  assert.equal(emptyShowcaseMarkup.includes("未生成"), false);
  assert.equal(emptyShowcaseMarkup.includes("作品集版不生成"), false);

  const builderSource = await fs.readFile(
    path.join(process.cwd(), "components", "detailed-study-plan-builder.tsx"),
    "utf8"
  );
  assert.equal(builderSource.includes("if (belongsToCurrentRepo) setSelectedDuration(duration)"), false);
  assert.ok(builderSource.includes("请等待当前任务"));
  assert.ok(builderSource.includes("[current?.step.id, plan.id, plan.days.length]"));
}

async function verifyNoKeyFallback() {
  const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const repo = seedRepos[0];
    const score = scoreRepository(repo, defaultPreference);
    const result = await analyzeRepositoryWithFallback(repo, score, defaultPreference);

    assert.equal(result.fallbackReason, "not-configured");
    assert.equal(result.analysis.repoId, repo.id);
    assert.deepEqual(result.providerAttempts, []);
  } finally {
    restoreEnv("DEEPSEEK_API_KEY", previousDeepSeekKey);
    restoreEnv("OPENAI_API_KEY", previousOpenAIKey);
  }
}

async function verifyDetailedStudyPlanFallback() {
  const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const recommendation = getRecommendations(defaultPreference)[0];
    const plan = await generateDetailedStudyPlan(recommendation, 3);

    assert.equal(plan.source, "rule");
    assert.equal(plan.fallbackReason, "not-configured");
    assert.equal(plan.days.length, 3);
    assert.deepEqual(plan.providerAttempts, []);
  } finally {
    restoreEnv("DEEPSEEK_API_KEY", previousDeepSeekKey);
    restoreEnv("OPENAI_API_KEY", previousOpenAIKey);
  }
}

async function verifySingleRepositoryAiFallback() {
  const repos = seedRepos.slice(0, 2);
  const scored = repos.map((repo) => ({
    repo,
    score: scoreRepository(repo, defaultPreference)
  }));

  const fakeAnalyzer = async (
    repo: RepoSnapshot,
    score: RuleScore,
    preference: UserPreference
  ): Promise<RepositoryAnalysisResult> => {
    const analysis = createRuleBasedAnalysis(repo, score, preference);

    if (repo.id === repos[0].id) {
      return {
        analysis,
        source: "rule",
        provider: "deepseek",
        modelId: "test-model",
        fallbackReason: "provider-error",
        errorSummary: "simulated model failure",
        providerAttempts: [
          {
            provider: "deepseek",
            modelId: "test-model",
            status: "failed",
            errorSummary: "simulated model failure"
          }
        ]
      };
    }

    return {
      analysis,
      source: "ai",
      provider: "deepseek",
      modelId: "test-model",
      providerAttempts: [
        {
          provider: "deepseek",
          modelId: "test-model",
          status: "success"
        }
      ]
    };
  };

  const result = await analyzeScoredCandidates(scored, defaultPreference, fakeAnalyzer);

  assert.equal(result.recommendations.length, 2);
  assert.equal(result.providerErrorFallbackCount, 1);
  assert.equal(result.missingProviderFallbackCount, 0);
  assert.ok(result.notes.some((note) => note.includes("DeepSeek fallback used for 1 repositories")));
  assert.equal(result.recommendations[0].rank, 1);
  assert.equal(result.recommendations[1].rank, 2);
  assert.equal(result.recommendations[0].analysisTrace?.providerAttempts[0]?.status, "failed");
  assert.equal(result.recommendations[1].analysisTrace?.providerAttempts[0]?.status, "success");
}

async function verifyUnexpectedAnalyzerFailure() {
  const repo = seedRepos[0];
  const scored = [{ repo, score: scoreRepository(repo, defaultPreference) }];
  const result = await analyzeScoredCandidates(scored, defaultPreference, async () => {
    throw new Error("simulated unhandled analyzer failure");
  });

  assert.equal(result.recommendations.length, 1);
  assert.equal(result.providerErrorFallbackCount, 1);
  assert.equal(result.recommendations[0].analysis.repoId, repo.id);
  assert.ok(result.notes.some((note) => note.includes("Unhandled analyzer failure")));
}

async function verifyAiCircuitBreaker() {
  const previousConcurrency = process.env.RADAR_AI_CONCURRENCY;
  process.env.RADAR_AI_CONCURRENCY = "2";
  const repos = seedRepos.slice(0, 5);
  const scored = repos.map((repo) => ({ repo, score: scoreRepository(repo, defaultPreference) }));
  let callCount = 0;
  let lastProgress = { completed: 0, total: 0 };

  try {
    const result = await analyzeScoredCandidates(
      scored,
      defaultPreference,
      async (repo, score, preference) => {
        callCount += 1;
        return {
          analysis: createRuleBasedAnalysis(repo, score, preference),
          source: "rule",
          fallbackReason: "provider-error",
          errorSummary: "simulated provider outage",
          providerAttempts: [
            {
              provider: "deepseek",
              modelId: "test-model",
              status: "failed",
              errorSummary: "simulated provider outage"
            }
          ]
        };
      },
      (completed, total) => {
        lastProgress = { completed, total };
      }
    );

    assert.equal(callCount, 2);
    assert.equal(result.providerErrorFallbackCount, 5);
    assert.equal(lastProgress.completed, 5);
    assert.equal(lastProgress.total, 5);
    assert.ok(result.notes.some((note) => note.includes("circuit breaker")));
  } finally {
    restoreEnv("RADAR_AI_CONCURRENCY", previousConcurrency);
  }
}

async function verifyConcurrentAnalysisKeepsRankOrder() {
  const repos = seedRepos.slice(0, 3);
  const scored = repos.map((repo) => ({
    repo,
    score: scoreRepository(repo, defaultPreference)
  }));
  const result = await analyzeScoredCandidates(scored, defaultPreference, async (repo, score, preference) => {
    await new Promise((resolve) => setTimeout(resolve, repo.id === repos[0].id ? 20 : 1));
    return {
      analysis: createRuleBasedAnalysis(repo, score, preference),
      source: "ai",
      providerAttempts: [
        {
          provider: "deepseek",
          modelId: "test-model",
          status: "success"
        }
      ]
    };
  });

  assert.deepEqual(
    result.recommendations.map((item) => item.repo.id),
    repos.map((repo) => repo.id)
  );
  assert.deepEqual(
    result.recommendations.map((item) => item.rank),
    [1, 2, 3]
  );
}

async function verifyAiAnalysisLimit() {
  const repos = seedRepos.slice(0, 5);
  const scored = repos.map((repo) => ({ repo, score: scoreRepository(repo, defaultPreference) }));
  let callCount = 0;
  let lastProgress = { completed: 0, total: 0 };

  const result = await analyzeScoredCandidates(
    scored,
    defaultPreference,
    async (repo, score, preference) => {
      callCount += 1;
      return {
        analysis: createRuleBasedAnalysis(repo, score, preference),
        source: "ai",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        providerAttempts: [
          {
            provider: "deepseek",
            modelId: "test-model",
            status: "success",
            usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
          }
        ]
      };
    },
    (completed, total) => {
      lastProgress = { completed, total };
    },
    2
  );

  assert.equal(callCount, 2);
  assert.equal(result.recommendations.length, 5);
  assert.equal(result.ruleOnlyCount, 3);
  assert.deepEqual(result.metrics, {
    aiRequestedCount: 2,
    aiSuccessCount: 2,
    aiFallbackCount: 0,
    inputTokens: 200,
    outputTokens: 40,
    totalTokens: 240
  });
  assert.deepEqual(lastProgress, { completed: 2, total: 2 });
  assert.ok(result.notes.some((note) => note.includes("top 2 repositories")));
}

async function verifyManualRefreshRequiresGithubToken() {
  const previousGithubToken = process.env.GITHUB_TOKEN;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.GITHUB_TOKEN;
  restoreEnv("NODE_ENV", "development");

  try {
    const { POST: refreshRadar } = await import("../app/api/radar/refresh/route");
    const response = await refreshRadar();
    const payload = (await response.json()) as { status?: string; code?: string };

    assert.equal(response.status, 503);
    assert.equal(payload.status, "error");
    assert.equal(payload.code, "github_token_missing");
  } finally {
    restoreEnv("GITHUB_TOKEN", previousGithubToken);
    restoreEnv("NODE_ENV", previousNodeEnv);
  }
}

async function verifyRefreshStatusEndpoint() {
  const { GET: getRefreshStatus } = await import("../app/api/radar/refresh/route");
  const response = await getRefreshStatus();
  const payload = (await response.json()) as { status?: string; job?: unknown };

  assert.equal(response.status, 200);
  assert.equal(payload.status, "idle");
  assert.equal(payload.job, null);
}

async function verifyStudyPlanRequestValidation() {
  const response = await createStudyPlan(
    new Request("http://localhost/api/study-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: "demo", repo: "demo", duration: 5 })
    })
  );
  const payload = (await response.json()) as { status?: string };

  assert.equal(response.status, 400);
  assert.equal(payload.status, "error");
}

async function verifyShowcaseCostFirewall() {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    deploymentMode: process.env.APP_DEPLOYMENT_MODE,
    databaseUrl: process.env.DATABASE_URL,
    jobRunStoreFile: process.env.JOB_RUN_STORE_FILE
  };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "learning-radar-showcase-"));
  const jobRunStoreFile = path.join(temporaryDirectory, "job-runs.json");
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  process.env.APP_DEPLOYMENT_MODE = "showcase";
  delete process.env.DATABASE_URL;
  process.env.JOB_RUN_STORE_FILE = jobRunStoreFile;

  try {
    const studyPlanResponse = await createStudyPlan(
      new Request("http://localhost/api/study-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "demo", repo: "demo", duration: 3 })
      })
    );
    assert.equal(studyPlanResponse.status, 403);
    assert.equal((await studyPlanResponse.json() as { code?: string }).code, "showcase_read_only");

    const { DELETE: cancelStudyPlan } = await import("../app/api/study-plans/route");
    const cancelResponse = await cancelStudyPlan(
      new Request("http://localhost/api/study-plans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: "must-not-be-read" })
      })
    );
    assert.equal(cancelResponse.status, 403);

    const { POST: refreshRadar } = await import("../app/api/radar/refresh/route");
    const refreshResponse = await refreshRadar();
    assert.equal(refreshResponse.status, 403);
    assert.equal((await refreshResponse.json() as { code?: string }).code, "showcase_read_only");

    const { GET: runCron } = await import("../app/api/cron/daily-radar/route");
    const cronResponse = await runCron(new Request("http://localhost/api/cron/daily-radar?force=1"));
    assert.equal(cronResponse.status, 403);

    await assert.rejects(
      () => enqueueDetailedStudyPlanJob({
        userId: "showcase-user",
        owner: "demo",
        repo: "demo",
        repoFullName: "demo/demo",
        duration: 3,
        force: false,
        preference: { level: "beginner", goal: "portfolio" }
      }),
      /showcase forbids detailed study plan job creation/
    );
    await assert.rejects(
      () => cancelDetailedStudyPlanJob("must-not-be-read", "showcase-user"),
      /showcase forbids detailed study plan job cancellation/
    );
    const { enqueueDailyRadarJob } = await import("../lib/radar-jobs");
    await assert.rejects(
      () => enqueueDailyRadarJob({ trigger: "manual" }),
      /showcase forbids daily radar job creation/
    );
    await assert.rejects(() => fs.access(jobRunStoreFile));
  } finally {
    restoreEnv("NODE_ENV", previous.nodeEnv);
    restoreEnv("APP_DEPLOYMENT_MODE", previous.deploymentMode);
    restoreEnv("DATABASE_URL", previous.databaseUrl);
    restoreEnv("JOB_RUN_STORE_FILE", previous.jobRunStoreFile);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function verifyAnonymousForceBoundary() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDeploymentMode = process.env.APP_DEPLOYMENT_MODE;
  const previousAdminSecret = process.env.ADMIN_SECRET;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  process.env.APP_DEPLOYMENT_MODE = "full";
  process.env.ADMIN_SECRET = "verification-admin-secret-000000000000000";

  try {
    const response = await createStudyPlan(
      new Request("http://localhost/api/study-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "demo", repo: "demo", duration: 3, force: true })
      })
    );
    const payload = await response.json() as { code?: string };
    assert.equal(response.status, 401);
    assert.equal(payload.code, "forced_generation_forbidden");

    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.ADMIN_SECRET;
    const developmentResponse = await createStudyPlan(
      new Request("http://localhost/api/study-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "demo", repo: "demo", duration: 3, force: true })
      })
    );
    assert.equal(developmentResponse.status, 503);
    assert.equal((await developmentResponse.json() as { code?: string }).code, "forced_generation_forbidden");
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("APP_DEPLOYMENT_MODE", previousDeploymentMode);
    restoreEnv("ADMIN_SECRET", previousAdminSecret);
  }
}

async function verifyRequestRateLimit() {
  const request = new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.10" } });
  const scope = `verify-${Date.now()}`;
  const first = await consumeRequestRateLimit(request, { scope, limit: 2, windowMs: 60_000 });
  const second = await consumeRequestRateLimit(request, { scope, limit: 2, windowMs: 60_000 });
  const third = await consumeRequestRateLimit(request, { scope, limit: 2, windowMs: 60_000 });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds > 0);
}

async function verifyDataRetention() {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const envNames = [
    "RADAR_RUN_STORE_FILE",
    "RADAR_RUN_ARCHIVE_FILE",
    "JOB_RUN_STORE_FILE",
    "DETAILED_STUDY_PLAN_STORE_FILE",
    "REPOSITORY_STORE_FILE",
    "LEARNING_PROGRESS_STORE_FILE"
  ] as const;
  const previousValues = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const temporaryDirectory = path.join(os.tmpdir(), `learning-radar-retention-${process.pid}-${Date.now()}`);
  const files = {
    radar: path.join(temporaryDirectory, "radar-runs.json"),
    archive: path.join(temporaryDirectory, "archive", "radar-runs.json"),
    jobs: path.join(temporaryDirectory, "job-runs.json"),
    plans: path.join(temporaryDirectory, "detailed-study-plans.json"),
    repositories: path.join(temporaryDirectory, "repository-store.json"),
    progress: path.join(temporaryDirectory, "learning-progress.json")
  };
  process.env.RADAR_RUN_STORE_FILE = files.radar;
  process.env.RADAR_RUN_ARCHIVE_FILE = files.archive;
  process.env.JOB_RUN_STORE_FILE = files.jobs;
  process.env.DETAILED_STUDY_PLAN_STORE_FILE = files.plans;
  process.env.REPOSITORY_STORE_FILE = files.repositories;
  process.env.LEARNING_PROGRESS_STORE_FILE = files.progress;
  delete process.env.DATABASE_URL;
  const now = new Date("2030-01-01T00:00:00.000Z");
  const policy: DataRetentionPolicy = {
    radarRunDays: 30,
    minimumRadarRuns: 1,
    terminalJobDays: 30,
    detailedPlanDays: 30,
    repositorySnapshotDays: 30,
    staleCandidateDays: 30,
    rateLimitDays: 7
  };
  const recommendations = getRecommendations(defaultPreference).slice(0, 2);
  const makeRun = (runId: string, finishedAt: string, items = recommendations): RadarRun => ({
    runId,
    date: finishedAt.slice(0, 10),
    source: "github",
    status: "success",
    startedAt: finishedAt,
    finishedAt,
    rawCandidateCount: items.length,
    recommendationCount: items.length,
    notes: [],
    preference: defaultPreference,
    recommendations: items
  });
  const recommendation = recommendations[0];
  const basePlan3 = createRuleBasedDetailedStudyPlan(recommendation, 3);
  const basePlan7 = createRuleBasedDetailedStudyPlan(recommendation, 7);
  const oldPlan = { ...basePlan3, id: "old-plan", generatedAt: "2028-01-01T00:00:00.000Z" };
  const newPlan = { ...basePlan3, id: "new-plan", generatedAt: "2029-12-20T00:00:00.000Z" };
  const progressPlan = { ...basePlan7, id: "progress-plan", generatedAt: "2028-01-01T00:00:00.000Z" };
  const newerPlan7 = { ...basePlan7, id: "newer-plan-7", generatedAt: "2029-12-20T00:00:00.000Z" };
  const protectedRadarRepo = recommendations[1].repo;
  const protectedPlanRepo = recommendation.repo;
  const recentRepo = { ...seedRepos[2], updatedAt: "2029-12-20T00:00:00.000Z" };
  const staleRepo = {
    ...seedRepos[5],
    updatedAt: "2028-01-01T00:00:00.000Z",
    pushedAt: "2028-01-01T00:00:00.000Z"
  };

  try {
    await fs.mkdir(temporaryDirectory, { recursive: true });
    await Promise.all([
      fs.writeFile(
        files.radar,
        `${JSON.stringify({
          runs: [
            makeRun("old-run-1", "2028-01-01T00:00:00.000Z"),
            makeRun("old-run-2", "2028-02-01T00:00:00.000Z"),
            makeRun("latest-run", "2029-12-20T00:00:00.000Z")
          ]
        })}\n`,
        "utf8"
      ),
      fs.writeFile(
        files.jobs,
        `${JSON.stringify({
          jobs: [
            createRetentionJob("old-terminal", "success", "2028-01-01T00:00:00.000Z"),
            createRetentionJob("old-running", "running", "2028-01-01T00:00:00.000Z"),
            createRetentionJob("recent-terminal", "failed", "2029-12-20T00:00:00.000Z")
          ]
        })}\n`,
        "utf8"
      ),
      fs.writeFile(files.plans, `${JSON.stringify({ plans: [oldPlan, newPlan, progressPlan, newerPlan7] })}\n`, "utf8"),
      fs.writeFile(
        files.progress,
        `${JSON.stringify({ users: { anon_test: { "detailed:progress-plan": { step: {} } } } })}\n`,
        "utf8"
      ),
      fs.writeFile(
        files.repositories,
        `${JSON.stringify({
          repositories: Object.fromEntries(
            [protectedRadarRepo, protectedPlanRepo, recentRepo, staleRepo].map((repo) => [String(repo.id), repo])
          ),
          snapshots: {
            [String(protectedRadarRepo.id)]: [
              { snapshotDate: "2028-01-01" },
              { snapshotDate: "2029-12-20" }
            ],
            [String(protectedPlanRepo.id)]: [{ snapshotDate: "2029-12-20" }],
            [String(recentRepo.id)]: [
              { snapshotDate: "2028-01-01" },
              { snapshotDate: "2029-12-20" }
            ],
            [String(staleRepo.id)]: [
              { snapshotDate: "2028-01-01" },
              { snapshotDate: "2028-02-01" }
            ]
          }
        })}\n`,
        "utf8"
      )
    ]);
    await consumeRequestRateLimit(new Request("http://localhost", { headers: { "x-forwarded-for": "198.51.100.55" } }), {
      scope: "retention-verification",
      limit: 5,
      windowMs: 60_000
    });

    const radarBefore = await fs.readFile(files.radar, "utf8");
    const dryRun = await runDataRetention({ now, policy });
    assert.equal(dryRun.mode, "dry-run");
    assert.equal(dryRun.storage, "local-json");
    assert.equal(dryRun.counts.radarRunsArchived, 2);
    assert.equal(dryRun.counts.terminalJobsDeleted, 1);
    assert.equal(dryRun.counts.detailedPlansDeleted, 1);
    assert.equal(dryRun.counts.repositorySnapshotsDeleted, 4);
    assert.equal(dryRun.counts.staleCandidatesDeleted, 1);
    assert.ok(dryRun.counts.rateLimitBucketsDeleted >= 1);
    assert.equal(await fs.readFile(files.radar, "utf8"), radarBefore);
    await assertFileMissing(files.archive);

    const applied = await runDataRetention({ apply: true, now, policy });
    assert.deepEqual(applied.counts, dryRun.counts);
    const retainedRadar = JSON.parse(await fs.readFile(files.radar, "utf8")) as { runs: RadarRun[] };
    const archive = JSON.parse(await fs.readFile(files.archive, "utf8")) as { runs: RadarRun[] };
    const retainedJobs = JSON.parse(await fs.readFile(files.jobs, "utf8")) as { jobs: JobRun[] };
    const retainedPlans = JSON.parse(await fs.readFile(files.plans, "utf8")) as { plans: DetailedStudyPlan[] };
    const retainedRepositories = JSON.parse(await fs.readFile(files.repositories, "utf8")) as {
      repositories: Record<string, RepoSnapshot>;
      snapshots: Record<string, unknown[]>;
    };
    assert.deepEqual(retainedRadar.runs.map((run) => run.runId), ["latest-run"]);
    assert.deepEqual(archive.runs.map((run) => run.runId), ["old-run-1", "old-run-2"]);
    assert.equal(retainedJobs.jobs.some((job) => job.runId === "old-terminal"), false);
    assert.equal(retainedJobs.jobs.some((job) => job.runId === "old-running"), true);
    assert.equal(retainedPlans.plans.some((plan) => plan.id === "old-plan"), false);
    assert.equal(retainedPlans.plans.some((plan) => plan.id === "progress-plan"), true);
    assert.equal(String(staleRepo.id) in retainedRepositories.repositories, false);
    assert.equal(retainedRepositories.snapshots[String(protectedRadarRepo.id)].length, 1);

    const repeated = await runDataRetention({ apply: true, now, policy });
    assert.deepEqual(repeated.counts, {
      radarRunsArchived: 0,
      terminalJobsDeleted: 0,
      detailedPlansDeleted: 0,
      repositorySnapshotsDeleted: 0,
      staleCandidatesDeleted: 0,
      rateLimitBucketsDeleted: 0
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    for (const name of envNames) restoreEnv(name, previousValues[name]);
  }
}

function createRetentionJob(runId: string, status: JobRun["status"], timestamp: string): JobRun {
  return {
    runId,
    idempotencyKey: `retention:${runId}`,
    jobName: "daily-radar",
    status,
    stage: null,
    progress: { completed: 0, total: 0 },
    attemptCount: 1,
    maxAttempts: 3,
    payload: {},
    summary: {},
    errorSummary: null,
    errorCategory: null,
    createdAt: timestamp,
    availableAt: timestamp,
    startedAt: status === "running" ? timestamp : null,
    finishedAt: terminalJobStatusesForVerification.has(status) ? timestamp : null,
    heartbeatAt: status === "running" ? timestamp : null,
    updatedAt: timestamp
  };
}

const terminalJobStatusesForVerification = new Set<JobRun["status"]>([
  "success",
  "partial",
  "failed",
  "cancelled"
]);

async function assertFileMissing(file: string) {
  try {
    await fs.access(file);
    assert.fail(`${file} should not exist.`);
  } catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
  }
}

async function verifyPersistentJobRuns() {
  const previousJobStoreFile = process.env.JOB_RUN_STORE_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const temporaryFile = path.join(os.tmpdir(), `learning-radar-job-runs-${process.pid}-${Date.now()}.json`);
  process.env.JOB_RUN_STORE_FILE = temporaryFile;
  delete process.env.DATABASE_URL;

  try {
    const jobs = await import("../lib/job-runs");
    const createdAt = new Date("2030-01-01T00:00:00.000Z");
    const first = await jobs.createOrReuseJobRun(
      {
        idempotencyKey: jobs.createDailyRadarIdempotencyKey(createdAt),
        jobName: "daily-radar",
        maxAttempts: 3,
        payload: { trigger: "verify" }
      },
      createdAt
    );
    const duplicate = await jobs.createOrReuseJobRun(
      {
        idempotencyKey: jobs.createDailyRadarIdempotencyKey(createdAt),
        jobName: "daily-radar"
      },
      new Date("2030-01-01T00:01:00.000Z")
    );

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.runId, first.job.runId);

    const running = await jobs.markJobRunRunning(
      first.job.runId,
      "github-discovery",
      new Date("2030-01-01T00:02:00.000Z")
    );
    assert.equal(running?.status, "running");
    assert.equal(running?.attemptCount, 1);
    assert.equal(running?.heartbeatAt, "2030-01-01T00:02:00.000Z");

    const progressing = await jobs.updateJobRunProgress(
      first.job.runId,
      { stage: "ai-analysis", completed: 2, total: 3 },
      new Date("2030-01-01T00:03:00.000Z")
    );
    assert.deepEqual(progressing?.progress, { completed: 2, total: 3 });
    assert.equal(progressing?.stage, "ai-analysis");

    const heartbeat = await jobs.touchJobRunHeartbeat(first.job.runId, new Date("2030-01-01T00:04:00.000Z"));
    assert.equal(heartbeat?.heartbeatAt, "2030-01-01T00:04:00.000Z");

    const failed = await jobs.finishJobRun(
      first.job.runId,
      {
        status: "failed",
        stage: "ai-analysis",
        summary: { completedCandidates: 2 },
        errorSummary: "provider rejected sk-verification-secret"
      },
      new Date("2030-01-01T00:05:00.000Z")
    );
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.stage, "ai-analysis");
    assert.equal(failed?.errorSummary, "provider rejected [redacted]");

    const persisted = await jobs.getJobRun(first.job.runId);
    assert.equal(persisted?.status, "failed");
    assert.equal(persisted?.summary.completedCandidates, 2);
    const failedJobs = await jobs.listJobRuns({ status: "failed" });
    assert.equal(failedJobs.length, 1);

    const fileStore = JSON.parse(await fs.readFile(temporaryFile, "utf8")) as { jobs?: unknown[] };
    assert.equal(fileStore.jobs?.length, 1);

    const radarJobs = await import("../lib/radar-jobs");
    const enqueued = await radarJobs.enqueueDailyRadarJob({
      trigger: "cron",
      now: new Date("2030-01-02T00:00:00.000Z")
    });
    const reused = await radarJobs.enqueueDailyRadarJob({
      trigger: "manual",
      now: new Date("2030-01-02T12:00:00.000Z")
    });
    assert.equal(enqueued.created, true);
    assert.equal(reused.created, false);
    assert.equal(reused.job.runId, enqueued.job.runId);

    const executed = await radarJobs.executeDailyRadarJob(enqueued.job.runId, {
      now: new Date("2030-01-02T00:00:01.000Z"),
      runner: async (options) => {
        await options?.onStage?.("github-discovery");
        await options?.onStage?.("ai-analysis", { completed: 2, total: 2 });
        return {
          runId: options?.runId ?? "missing-run-id",
          date: "2030-01-02",
          source: "github",
          status: "success",
          startedAt: options?.startedAt?.toISOString() ?? "2030-01-02T00:00:00.000Z",
          finishedAt: "2030-01-02T00:01:00.000Z",
          rawCandidateCount: 8,
          recommendationCount: 2,
          notes: [],
          recommendations: []
        };
      }
    });
    assert.equal(executed.status, "success", JSON.stringify(executed));
    assert.equal(executed.stage, "save-final-run");
    assert.equal(executed.summary.recommendationCount, 2);

    const staleJob = await jobs.createOrReuseJobRun(
      {
        idempotencyKey: "verify-stale-radar-job",
        jobName: "daily-radar",
        maxAttempts: 2
      },
      new Date("2030-01-03T00:00:00.000Z")
    );
    const competingClaims = await Promise.all([
      jobs.claimNextJobRun("daily-radar", "load-preferences", new Date("2030-01-03T00:00:10.000Z")),
      jobs.claimNextJobRun("daily-radar", "load-preferences", new Date("2030-01-03T00:00:10.000Z"))
    ]);
    assert.equal(competingClaims.filter(Boolean).length, 1);
    assert.equal(competingClaims.find(Boolean)?.runId, staleJob.job.runId);

    const firstRecovery = await jobs.recoverStaleJobRuns({
      jobName: "daily-radar",
      staleBefore: new Date("2030-01-03T00:01:00.000Z"),
      now: new Date("2030-01-03T00:02:00.000Z")
    });
    assert.deepEqual(firstRecovery.requeuedRunIds, [staleJob.job.runId]);
    const retried = await jobs.claimNextJobRun(
      "daily-radar",
      "load-preferences",
      new Date("2030-01-03T00:03:00.000Z")
    );
    assert.equal(retried?.attemptCount, 2);
    const exhaustedRecovery = await jobs.recoverStaleJobRuns({
      jobName: "daily-radar",
      staleBefore: new Date("2030-01-03T00:04:00.000Z"),
      now: new Date("2030-01-03T00:05:00.000Z")
    });
    assert.deepEqual(exhaustedRecovery.failedRunIds, [staleJob.job.runId]);
    assert.equal((await jobs.getJobRun(staleJob.job.runId))?.status, "failed");

    const workerCreatedAt = new Date();
    const workerJob = await jobs.createOrReuseJobRun(
      {
        idempotencyKey: `verify-worker-${workerCreatedAt.toISOString()}`,
        jobName: "daily-radar"
      },
      workerCreatedAt
    );
    let workerExecutions = 0;
    let heartbeatAdvanced = false;
    const workerRunner = async (options?: DailyRadarRunOptions) => {
      workerExecutions += 1;
      for (let attempt = 0; attempt < 8 && !heartbeatAdvanced; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        const duringRun = await jobs.getJobRun(options?.runId ?? "");
        heartbeatAdvanced = Boolean(duringRun?.heartbeatAt && duringRun.heartbeatAt !== duringRun.startedAt);
      }
      return {
        runId: options?.runId ?? "missing-run-id",
        date: workerCreatedAt.toISOString().slice(0, 10),
        source: "github" as const,
        status: "success" as const,
        startedAt: options?.startedAt?.toISOString() ?? workerCreatedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        rawCandidateCount: 4,
        recommendationCount: 1,
        notes: [],
        recommendations: []
      };
    };
    const { runRadarWorkerOnce } = await import("../lib/radar-worker");
    const workerResults = await Promise.all([
      runRadarWorkerOnce({ runner: workerRunner, heartbeatIntervalMs: 10, now: workerCreatedAt }),
      runRadarWorkerOnce({ runner: workerRunner, heartbeatIntervalMs: 10, now: workerCreatedAt })
    ]);
    assert.equal(workerResults.filter((result) => result.status === "processed").length, 1);
    assert.equal(workerExecutions, 1);
    assert.equal(heartbeatAdvanced, true);
    assert.equal((await jobs.getJobRun(workerJob.job.runId))?.status, "success");
    await radarJobs.executeDailyRadarJob(workerJob.job.runId, { runner: workerRunner });
    assert.equal(workerExecutions, 1);

    const retryStart = new Date("2030-01-04T00:00:00.000Z");
    const retryJob = await jobs.createOrReuseJobRun(
      {
        idempotencyKey: "verify-retry-radar-job",
        jobName: "daily-radar"
      },
      retryStart
    );
    const retryableError = Object.assign(new Error("temporary upstream outage"), {
      statusCode: 503,
      isRetryable: true
    });
    const waitingRetry = await radarJobs.executeDailyRadarJob(retryJob.job.runId, {
      now: new Date("2030-01-04T00:00:01.000Z"),
      runner: async () => {
        throw retryableError;
      }
    });
    assert.equal(waitingRetry.status, "queued");
    assert.equal(waitingRetry.stage, "retry-queued");
    assert.equal(waitingRetry.errorCategory, "application_server");
    assert.equal(waitingRetry.availableAt, "2030-01-04T00:00:06.000Z");
    const delayedQueueHealth = await jobs.getJobQueueHealth(
      "daily-radar",
      new Date("2030-01-04T00:00:05.000Z")
    );
    assert.equal(delayedQueueHealth.queued, 1);
    assert.equal(delayedQueueHealth.readyQueued, 0);
    assert.equal(delayedQueueHealth.oldestQueuedAt, null);
    assert.equal(
      await jobs.markJobRunRunning(
        retryJob.job.runId,
        "load-preferences",
        new Date("2030-01-04T00:00:05.000Z")
      ),
      null
    );
    const retryClaim = await jobs.markJobRunRunning(
      retryJob.job.runId,
      "load-preferences",
      new Date("2030-01-04T00:00:06.000Z")
    );
    assert.equal(retryClaim?.attemptCount, 2);
    await jobs.finishJobRun(
      retryJob.job.runId,
      { status: "cancelled" },
      new Date("2030-01-04T00:00:07.000Z")
    );

    const previousNodeEnv = process.env.NODE_ENV;
    const previousGithubToken = process.env.GITHUB_TOKEN;
    const previousAutostart = process.env.RADAR_DISABLE_LOCAL_JOB_AUTOSTART;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.GITHUB_TOKEN = "verification-github-token";
    process.env.RADAR_DISABLE_LOCAL_JOB_AUTOSTART = "1";
    try {
      const refreshRoute = await import("../app/api/radar/refresh/route");
      const enqueueResponse = await refreshRoute.POST();
      const enqueuePayload = (await enqueueResponse.json()) as {
        status?: string;
        runId?: string;
        statusUrl?: string;
        job?: { runId?: string; status?: string; payload?: unknown };
      };
      assert.equal(enqueueResponse.status, 202);
      assert.equal(enqueuePayload.status, "queued");
      assert.equal(enqueuePayload.runId, enqueuePayload.job?.runId);
      assert.ok(enqueuePayload.statusUrl?.startsWith("/api/jobs/"));
      assert.equal("payload" in (enqueuePayload.job ?? {}), false);

      const statusResponse = await refreshRoute.GET(
        new Request(`http://localhost/api/radar/refresh?runId=${encodeURIComponent(enqueuePayload.runId ?? "")}`)
      );
      const statusPayload = (await statusResponse.json()) as { status?: string; job?: { runId?: string } };
      assert.equal(statusResponse.status, 200);
      assert.equal(statusPayload.status, "queued");
      assert.equal(statusPayload.job?.runId, enqueuePayload.runId);
    } finally {
      restoreEnv("NODE_ENV", previousNodeEnv);
      restoreEnv("GITHUB_TOKEN", previousGithubToken);
      restoreEnv("RADAR_DISABLE_LOCAL_JOB_AUTOSTART", previousAutostart);
    }

    const { GET: getJobStatus } = await import("../app/api/jobs/[runId]/route");
    const response = await getJobStatus(
      new Request(`http://localhost/api/jobs/${encodeURIComponent(first.job.runId)}`),
      { params: Promise.resolve({ runId: first.job.runId }) }
    );
    const payload = (await response.json()) as {
      status?: string;
      job?: { status?: string; stage?: string; errorSummary?: string; payload?: unknown };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.status, "success");
    assert.equal(payload.job?.status, "failed");
    assert.equal(payload.job?.stage, "ai-analysis");
    assert.equal(payload.job?.errorSummary, "provider rejected [redacted]");
    assert.equal("payload" in (payload.job ?? {}), false);

    const malformedRunIdResponse = await getJobStatus(
      new Request("http://localhost/api/jobs/%"),
      { params: Promise.resolve({ runId: "%" }) }
    );
    assert.equal(malformedRunIdResponse.status, 400);
  } finally {
    await fs.rm(temporaryFile, { force: true });
    restoreEnv("JOB_RUN_STORE_FILE", previousJobStoreFile);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
  }
}

async function verifyHealthEndpoint() {
  const { GET: getHealth } = await import("../app/api/health/route");
  const response = await getHealth();
  const payload = (await response.json()) as {
    status?: string;
    storage?: string;
    taskQueue?: { queued?: number; readyQueued?: number; running?: number; staleRunning?: number };
    studyPlanQueue?: { queued?: number; readyQueued?: number; running?: number; staleRunning?: number };
    degradedReasons?: string[];
  };

  assert.equal(response.status, 200);
  assert.equal(payload.status, "ok");
  assert.equal(payload.storage, "local-json");
  assert.equal(payload.taskQueue?.queued, 0);
  assert.equal(payload.taskQueue?.readyQueued, 0);
  assert.equal(payload.taskQueue?.running, 0);
  assert.equal(payload.taskQueue?.staleRunning, 0);
  assert.equal(payload.studyPlanQueue?.queued, 0);
  assert.equal(payload.studyPlanQueue?.running, 0);
  assert.equal(payload.studyPlanQueue?.staleRunning, 0);
  assert.deepEqual(payload.degradedReasons, []);
}

async function verifyCandidateStore() {
  const candidates = await listRepositoryCandidates(5);

  if (candidates.length === 0) return;
  assert.ok(candidates.length <= 5);
  assert.ok(candidates[0].fullName.includes("/"));

  const candidate = await getRepositoryCandidate(candidates[0].owner, candidates[0].name);
  assert.equal(candidate?.id, candidates[0].id);
}

async function verifyCandidateLearningRecommendation() {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousRepositoryStore = process.env.REPOSITORY_STORE_FILE;
  const previousRadarRunStore = process.env.RADAR_RUN_STORE_FILE;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "learning-radar-candidate-plan-"));
  const repositoryStore = path.join(temporaryDirectory, "repositories.json");
  const radarRunStore = path.join(temporaryDirectory, "radar-runs.json");
  const candidate = {
    ...seedRepos[0],
    id: 990001,
    owner: "candidate-only",
    name: "study-plan-entry",
    fullName: "candidate-only/study-plan-entry",
    url: "https://github.com/candidate-only/study-plan-entry"
  };

  delete process.env.DATABASE_URL;
  process.env.REPOSITORY_STORE_FILE = repositoryStore;
  process.env.RADAR_RUN_STORE_FILE = radarRunStore;
  try {
    await fs.writeFile(
      repositoryStore,
      `${JSON.stringify({ repositories: { [String(candidate.id)]: candidate }, snapshots: {} })}\n`,
      "utf8"
    );
    await fs.writeFile(radarRunStore, `${JSON.stringify({ runs: [] })}\n`, "utf8");
    const recommendation = await getLearningRecommendation(candidate.owner, candidate.name, {
      level: "beginner",
      goal: "portfolio"
    });

    assert.equal(recommendation?.repo.fullName, candidate.fullName);
    assert.equal(recommendation?.analysisTrace?.source, "rule");
    assert.equal(recommendation?.rank, 0);
    assert.ok((recommendation?.analysis.miniCloneScope.goal.length ?? 0) > 0);
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("REPOSITORY_STORE_FILE", previousRepositoryStore);
    restoreEnv("RADAR_RUN_STORE_FILE", previousRadarRunStore);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
