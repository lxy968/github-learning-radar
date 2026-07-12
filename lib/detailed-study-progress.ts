import type { DetailedStudyPlan } from "@/lib/types";

export function getDetailedStudyPlanStorageKey(planId: string) {
  return `detailed-study-plan:${planId}`;
}

export function getDetailedStudyPlanSteps(plan: DetailedStudyPlan) {
  return plan.days.flatMap((day) => day.steps);
}
