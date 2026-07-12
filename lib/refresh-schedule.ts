import type { RadarRun, RefreshInterval } from "@/lib/types";

export type RefreshScheduleDecision = {
  shouldRun: boolean;
  reason: string;
  nextSuggestedRefreshAt: string | null;
};

export function getRefreshScheduleDecision(
  latestRun: Pick<RadarRun, "finishedAt"> | null,
  interval: RefreshInterval,
  nowMs = Date.now()
): RefreshScheduleDecision {
  if (interval === "never") {
    return {
      shouldRun: false,
      reason: "你已设置为永不自动刷新；仍然可以手动点击“刷新雷达”。",
      nextSuggestedRefreshAt: null
    };
  }

  if (!latestRun) {
    return { shouldRun: true, reason: "还没有历史运行记录。", nextSuggestedRefreshAt: null };
  }

  const lastFinishedAt = new Date(latestRun.finishedAt).getTime();
  if (!Number.isFinite(lastFinishedAt)) {
    return { shouldRun: true, reason: "上一条运行时间无效，需要重新刷新。", nextSuggestedRefreshAt: null };
  }

  const nextSuggestedRefreshAt = new Date(lastFinishedAt + intervalToMs(interval)).toISOString();

  if (nowMs >= new Date(nextSuggestedRefreshAt).getTime()) {
    return { shouldRun: true, reason: "已到达设置的刷新间隔。", nextSuggestedRefreshAt };
  }

  return {
    shouldRun: false,
    reason: "还没有到达你设置的刷新间隔。",
    nextSuggestedRefreshAt
  };
}

function intervalToMs(interval: RefreshInterval) {
  const day = 24 * 60 * 60 * 1000;

  if (interval === "three-days") return 3 * day;
  if (interval === "weekly") return 7 * day;
  if (interval === "monthly") return 30 * day;
  return day;
}
