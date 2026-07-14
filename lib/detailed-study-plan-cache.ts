import { createHash } from "node:crypto";
import { getAiModelId } from "@/lib/ai/provider";
import { getRepoSignal } from "@/lib/repository-signals";
import type {
  DetailedStudyPlan,
  DetailedStudyPlanCacheMetadata,
  DetailedStudyPlanDuration,
  RadarRecommendation,
  UserPreference
} from "@/lib/types";

export const detailedStudyPlanPromptVersion = "detailed-plan-prompt-v5";
export const detailedStudyPlanSchemaVersion = "detailed-plan-schema-v4";
export const detailedStudyPlanRuleModel = "rule-v4";

export type DetailedStudyPlanGenerationContext = {
  preference: Pick<UserPreference, "level" | "goal">;
  cache: DetailedStudyPlanCacheMetadata;
};

export function createDetailedStudyPlanGenerationContext(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  preference: Pick<UserPreference, "level" | "goal">,
  env: NodeJS.ProcessEnv = process.env
): DetailedStudyPlanGenerationContext {
  return {
    preference: { level: preference.level, goal: preference.goal },
    cache: buildDetailedStudyPlanCacheMetadata(recommendation, duration, preference, env)
  };
}

export function buildDetailedStudyPlanCacheMetadata(
  recommendation: RadarRecommendation,
  duration: DetailedStudyPlanDuration,
  preference: Pick<UserPreference, "level" | "goal">,
  env: NodeJS.ProcessEnv = process.env
): DetailedStudyPlanCacheMetadata {
  const provider = "deepseek";
  const modelId = getAiModelId("detailed-study-plan", env);
  const inputHash = sha256(
    JSON.stringify({
      duration,
      repo: compactRepositoryInput(recommendation),
      score: recommendation.score,
      analysis: {
        projectType: recommendation.analysis.projectType,
        difficulty: recommendation.analysis.difficulty,
        learningTags: recommendation.analysis.learningTags,
        miniCloneScope: recommendation.analysis.miniCloneScope,
        risks: recommendation.analysis.risks
      }
    })
  );
  const metadataWithoutKey = {
    inputHash,
    preferenceLevel: preference.level,
    preferenceGoal: preference.goal,
    promptVersion: detailedStudyPlanPromptVersion,
    schemaVersion: detailedStudyPlanSchemaVersion,
    provider,
    modelId
  } as const;

  return {
    key: sha256(JSON.stringify(metadataWithoutKey)),
    ...metadataWithoutKey
  };
}

export function isDetailedStudyPlanCacheMatch(
  plan: { cache?: DetailedStudyPlanCacheMetadata },
  expected: DetailedStudyPlanCacheMetadata
) {
  return Boolean(plan.cache?.key && plan.cache.key === expected.key);
}

export function filterDetailedStudyPlansForActiveProfile(
  plans: DetailedStudyPlan[],
  preference: Pick<UserPreference, "level" | "goal">,
  env: NodeJS.ProcessEnv = process.env
) {
  const provider = "deepseek";
  const modelId = getAiModelId("detailed-study-plan", env);
  return plans.filter(
    (plan) =>
      plan.cache?.preferenceLevel === preference.level &&
      plan.cache.preferenceGoal === preference.goal &&
      plan.cache.promptVersion === detailedStudyPlanPromptVersion &&
      plan.cache.schemaVersion === detailedStudyPlanSchemaVersion &&
      plan.cache.provider === provider &&
      plan.cache.modelId === modelId
  );
}

function compactRepositoryInput(recommendation: RadarRecommendation) {
  const { repo } = recommendation;
  return {
    id: repo.id,
    fullName: repo.fullName,
    description: repo.description,
    category: repo.category,
    primaryLanguage: repo.primaryLanguage,
    languages: [...repo.languages].sort((a, b) => a.name.localeCompare(b.name) || b.bytes - a.bytes),
    topics: sortedStrings(repo.topics),
    pushedAt: repo.pushedAt,
    readmeExcerpt: repo.readmeExcerpt,
    detectedFiles: sortedStrings(repo.detectedFiles),
    dependencies: sortedStrings(repo.dependencies),
    enrichment: {
      readme: getRepoSignal(repo, "readme"),
      languages: getRepoSignal(repo, "languages"),
      rootFiles: getRepoSignal(repo, "rootFiles"),
      tests: getRepoSignal(repo, "tests"),
      examples: getRepoSignal(repo, "examples"),
      ci: getRepoSignal(repo, "ci"),
      docker: getRepoSignal(repo, "docker")
    }
  };
}

function sortedStrings(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
