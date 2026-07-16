import { isShowcaseMode } from "@/lib/deployment-mode";
import { showcaseStudyPlans as generatedShowcaseStudyPlans } from "@/lib/showcase-content";
import type { DetailedStudyPlan, RadarRecommendation, UserPreference } from "@/lib/types";

export const showcaseStudyPlanVersion = "showcase-deepseek-cache-v1";

export function listShowcaseStudyPlans(
  recommendations: RadarRecommendation[],
  preference: Pick<UserPreference, "level" | "goal">,
  env: NodeJS.ProcessEnv = process.env
): DetailedStudyPlan[] {
  if (!isShowcaseMode(env)) return [];
  const repositoryIds = new Set(recommendations.map((recommendation) => recommendation.repo.id));
  return generatedShowcaseStudyPlans
    .filter((plan) => repositoryIds.has(plan.repoId))
    .map(toPublicShowcasePlan);
}

export function createShowcaseStudyPlan(
  recommendation: RadarRecommendation,
  preference: Pick<UserPreference, "level" | "goal">,
  env: NodeJS.ProcessEnv = process.env
): DetailedStudyPlan {
  void preference;
  if (!isShowcaseMode(env)) throw new Error("Showcase plans are unavailable outside showcase mode.");
  const plan = generatedShowcaseStudyPlans.find(
    (candidate) => candidate.repoId === recommendation.repo.id && candidate.duration === 3
  );
  if (!plan) throw new Error(`No showcase plan is prepared for ${recommendation.repo.fullName}.`);
  return toPublicShowcasePlan(plan);
}

function toPublicShowcasePlan(plan: DetailedStudyPlan): DetailedStudyPlan {
  return {
    ...plan,
    provider: undefined,
    modelId: undefined,
    providerAttempts: [],
    cache: undefined
  };
}
