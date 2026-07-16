import showcasePlan14Part1Json from "@/lib/showcase-plan-14-part-1.json";
import showcasePlan14Part2Json from "@/lib/showcase-plan-14-part-2.json";
import showcasePlan3Json from "@/lib/showcase-plan-3.json";
import showcasePlan7Json from "@/lib/showcase-plan-7.json";
import showcaseRecommendationJson from "@/lib/showcase-recommendation.json";
import type { DetailedStudyPlan, RadarRecommendation } from "@/lib/types";

export const showcaseRecommendation = showcaseRecommendationJson as unknown as RadarRecommendation;

const showcasePlan14 = {
  ...showcasePlan14Part1Json,
  days: [...showcasePlan14Part1Json.days, ...showcasePlan14Part2Json.days]
} as unknown as DetailedStudyPlan;

export const showcaseStudyPlans = [
  showcasePlan3Json as unknown as DetailedStudyPlan,
  showcasePlan7Json as unknown as DetailedStudyPlan,
  showcasePlan14
].sort((left, right) => left.duration - right.duration);

export const showcaseProfile = {
  level: showcaseStudyPlans[0]?.cache?.preferenceLevel ?? "beginner",
  goal: showcaseStudyPlans[0]?.cache?.preferenceGoal ?? "portfolio"
} as const;

export const showcaseFeaturedRepoId = showcaseRecommendation.repo.id;
