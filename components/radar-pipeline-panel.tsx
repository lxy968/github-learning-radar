import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

const stages = [
  ["1", "GitHub 发现", "固定查询搜索仓库，并读取语言、README 和根目录信号。这里不调用 AI。"],
  ["2", "规则评分", "代码根据趋势、学习价值、复刻难度、健康度和兴趣匹配进行排序。"],
  ["3", "AI 分析", "只分析规则分最高的候选，生成项目总结、mini 复刻范围和 3/7/14 天学习路线。"],
  ["4", "保存雷达", "AI 失败时使用规则 fallback，仍然保存本次新的 GitHub 推荐。"]
] as const;

export function RadarPipelinePanel({ candidateCount, source }: { candidateCount: number; source: "local" | "seed" }) {
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">候选项目如何变成学习雷达</h2>
          <p className="mt-1 text-sm text-slate-600">
            当前展示 {candidateCount} 个{source === "local" ? "已抓取" : "种子"}候选；候选不等于最终推荐。
          </p>
        </div>
        <Badge tone={source === "local" ? "green" : "amber"}>
          {source === "local" ? "已抓取候选库" : "内置演示候选快照"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        {stages.map(([step, title, description]) => (
          <div key={step} className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold text-teal-700">阶段 {step}</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
