import type { RuleScore } from "@/lib/types";

const scoreItems = [
  ["趋势", "trendScore"],
  ["学习", "learningValueScore"],
  ["复刻", "cloneabilityScore"],
  ["健康", "repoHealthScore"],
  ["匹配", "userMatchScore"]
] as const;

export function ScoreBars({ score }: { score: RuleScore }) {
  return (
    <div className="grid gap-2">
      {scoreItems.map(([label, key]) => (
        <div key={key} className="grid grid-cols-[44px_1fr_32px] items-center gap-2 text-xs">
          <span className="text-slate-500">{label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-teal-600" style={{ width: `${score[key]}%` }} />
          </div>
          <span className="text-right font-medium text-slate-700">{score[key]}</span>
        </div>
      ))}
    </div>
  );
}
