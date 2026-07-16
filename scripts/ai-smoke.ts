import { analyzeRepositoryWithFallback } from "../lib/ai/analyze";
import { generateDetailedStudyPlan } from "../lib/ai/detailed-study-plan";
import { getConfiguredAiModel } from "../lib/ai/provider";
import { isShowcaseMode } from "../lib/deployment-mode";
import { createDetailedStudyPlanGenerationContext } from "../lib/detailed-study-plan-cache";
import { getCurrentRecommendation } from "../lib/radar";
import { scoreRepository } from "../lib/scoring";
import { defaultPreference, seedRepos } from "../lib/seed-data";
import type { DetailedStudyPlanDuration, Difficulty, UserPreference } from "../lib/types";
import { loadLocalEnv } from "./load-local-env";

loadLocalEnv(".env.local");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (isShowcaseMode()) {
    throw new Error("AI smoke is disabled while APP_DEPLOYMENT_MODE=showcase.");
  }

  if (process.argv.includes("--study-plan")) {
    await smokeStudyPlan();
    return;
  }

  const configuredModel = getConfiguredAiModel("radar-analysis");

  if (!configuredModel) {
    console.log("AI smoke skipped: no DEEPSEEK_API_KEY configured.");
    return;
  }

  const repo = seedRepos[0];
  const score = scoreRepository(repo, defaultPreference);
  const result = await analyzeRepositoryWithFallback(repo, score, defaultPreference);

  console.log(`provider=${configuredModel.provider}`);
  console.log(`model=${configuredModel.modelId}`);
  console.log(`source=${result.source}`);

  if (result.source !== "ai") {
    console.log(`fallbackReason=${result.fallbackReason ?? "unknown"}`);
    if (result.errorSummary) console.log(`error=${result.errorSummary}`);
    process.exit(1);
  }

  console.log(`summary=${result.analysis.oneLineSummary.replace(/\s+/g, " ").slice(0, 160)}`);
}

async function smokeStudyPlan() {
  const configuredModel = getConfiguredAiModel("detailed-study-plan");
  if (!configuredModel) {
    console.log("Study plan smoke skipped: no DEEPSEEK_API_KEY configured.");
    return;
  }

  const repoFullName = readArgument("repo") ?? "NousResearch/hermes-agent";
  const [owner, repo, extra] = repoFullName.split("/");
  if (!owner || !repo || extra) throw new Error("--repo 必须是 owner/repo 格式。");
  const duration = normalizeDuration(Number(readArgument("duration") ?? 3));
  const level = normalizeLevel(readArgument("level") ?? "beginner");
  const goal = normalizeGoal(readArgument("goal") ?? "portfolio");
  const recommendation = await getCurrentRecommendation(owner, repo);
  if (!recommendation) throw new Error(`当前雷达没有找到 ${repoFullName}。`);
  const context = createDetailedStudyPlanGenerationContext(recommendation, duration, { level, goal });
  const startedAt = Date.now();
  const plan = await generateDetailedStudyPlan(recommendation, duration, context, { allowRuleFallback: false });
  const usage = plan.providerAttempts?.find((attempt) => attempt.status === "success")?.usage;

  console.log(`provider=${configuredModel.provider}`);
  console.log(`model=${configuredModel.modelId}`);
  console.log(`repo=${recommendation.repo.fullName}`);
  console.log(`duration=${duration}`);
  console.log(`days=${plan.days.length}`);
  console.log(`status=${plan.generationStatus}`);
  console.log(`elapsedMs=${Date.now() - startedAt}`);
  console.log(`inputTokens=${usage?.inputTokens ?? "unknown"}`);
  console.log(`outputTokens=${usage?.outputTokens ?? "unknown"}`);
  console.log(`totalTokens=${usage?.totalTokens ?? "unknown"}`);
}

function readArgument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function normalizeDuration(value: number): DetailedStudyPlanDuration {
  if (value === 3 || value === 7 || value === 14) return value;
  throw new Error("--duration 只能是 3、7 或 14。");
}

function normalizeLevel(value: string): Difficulty {
  if (value === "beginner" || value === "intermediate" || value === "advanced") return value;
  throw new Error("--level 只能是 beginner、intermediate 或 advanced。");
}

function normalizeGoal(value: string): UserPreference["goal"] {
  if (value === "clone" || value === "portfolio" || value === "trend" || value === "source-reading") return value;
  throw new Error("--goal 参数无效。");
}
