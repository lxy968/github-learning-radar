import { createHash } from "node:crypto";
import { createRuleBasedDetailedStudyPlan } from "@/lib/ai/detailed-study-plan";
import { createDetailedStudyPlanGenerationContext } from "@/lib/detailed-study-plan-cache";
import { isShowcaseMode } from "@/lib/deployment-mode";
import type { DetailedStudyPlan, RadarRecommendation, UserPreference } from "@/lib/types";

export const showcaseStudyPlanVersion = "showcase-plan-v1";
export const showcaseStudyPlanDuration = 3 as const;
const showcaseGeneratedAt = "2026-07-14T00:00:00.000Z";

export function listShowcaseStudyPlans(
  recommendations: RadarRecommendation[],
  preference: Pick<UserPreference, "level" | "goal">,
  env: NodeJS.ProcessEnv = process.env
): DetailedStudyPlan[] {
  if (!isShowcaseMode(env)) return [];
  return recommendations.map((recommendation) => createShowcaseStudyPlan(recommendation, preference, env));
}

export function createShowcaseStudyPlan(
  recommendation: RadarRecommendation,
  preference: Pick<UserPreference, "level" | "goal">,
  env: NodeJS.ProcessEnv = process.env
): DetailedStudyPlan {
  const context = createDetailedStudyPlanGenerationContext(
    recommendation,
    showcaseStudyPlanDuration,
    preference,
    env
  );
  const showcaseCache = {
    ...context.cache,
    key: createShowcaseCacheKey(context.cache.inputHash, preference),
    provider: "rule" as const,
    modelId: showcaseStudyPlanVersion
  };
  const generated = createRuleBasedDetailedStudyPlan(recommendation, showcaseStudyPlanDuration, {
    ...context,
    cache: showcaseCache
  });

  return {
    ...generated,
    id: `${showcaseStudyPlanVersion}-${recommendation.repo.id}-${showcaseCache.key.slice(0, 16)}`,
    generatedAt: showcaseGeneratedAt,
    source: "rule",
    provider: undefined,
    modelId: undefined,
    providerAttempts: [],
    fallbackReason: undefined,
    errorSummary: undefined,
    errorCategory: undefined,
    retryable: undefined,
    cache: showcaseCache,
    generatedThroughDay: showcaseStudyPlanDuration,
    generationStatus: "complete"
  };
}

function createShowcaseCacheKey(
  inputHash: string,
  preference: Pick<UserPreference, "level" | "goal">
) {
  return createHash("sha256")
    .update(JSON.stringify({
      version: showcaseStudyPlanVersion,
      inputHash,
      preferenceLevel: preference.level,
      preferenceGoal: preference.goal
    }))
    .digest("hex");
}
