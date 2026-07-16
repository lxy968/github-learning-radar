export type WorkerKind = "study-plan" | "radar";

type WorkerPollResult = {
  status: "idle" | "processed";
};

type WorkerRunners<RadarResult extends WorkerPollResult, StudyPlanResult extends WorkerPollResult> = {
  radar: () => Promise<RadarResult>;
  studyPlan: () => Promise<StudyPlanResult>;
};

export async function runFairWorkerCycle<
  RadarResult extends WorkerPollResult,
  StudyPlanResult extends WorkerPollResult
>(
  preferredKind: WorkerKind,
  workers: WorkerRunners<RadarResult, StudyPlanResult>
): Promise<
  | { worker: "radar"; result: RadarResult; nextPreferredKind: WorkerKind }
  | { worker: "study-plan"; result: StudyPlanResult; nextPreferredKind: WorkerKind }
> {
  if (preferredKind === "study-plan") {
    const studyPlanResult = await workers.studyPlan();
    if (studyPlanResult.status === "processed") {
      return { worker: "study-plan", result: studyPlanResult, nextPreferredKind: "radar" };
    }
    const radarResult = await workers.radar();
    return { worker: "radar", result: radarResult, nextPreferredKind: "study-plan" };
  }

  const radarResult = await workers.radar();
  if (radarResult.status === "processed") {
    return { worker: "radar", result: radarResult, nextPreferredKind: "study-plan" };
  }
  const studyPlanResult = await workers.studyPlan();
  return { worker: "study-plan", result: studyPlanResult, nextPreferredKind: "radar" };
}
