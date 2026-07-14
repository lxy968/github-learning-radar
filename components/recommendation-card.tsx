import Link from "next/link";
import { ArrowRight, ArrowUpRight, Clock3, GitFork, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FeedbackControls } from "@/components/feedback-controls";
import { ScoreBars } from "@/components/score-bars";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { formatNumber } from "@/lib/utils";
import type { RadarRecommendation } from "@/lib/types";

export function RecommendationCard({
  item,
  hasStudyPlan = false
}: {
  item: RadarRecommendation;
  hasStudyPlan?: boolean;
}) {
  const { repo, score, analysis, rank } = item;
  const [owner, name] = repo.fullName.split("/");
  const projectHref = `/projects/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const learningHref = `${projectHref}/learning-plan`;
  const coreFeatures = analysis.miniCloneScope.coreFeatures.slice(0, 3);
  const learningReasons = (analysis.whyLearn.length > 0 ? analysis.whyLearn : score.reasons).slice(0, 2);
  const fullReasons = Array.from(new Set([...analysis.whyLearn, ...score.reasons]));

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">今日 #{rank}</Badge>
            <Badge tone={analysis.difficulty === "advanced" ? "amber" : "blue"}>
              {difficultyLabel(analysis.difficulty)}
            </Badge>
            <Badge>{repo.primaryLanguage}</Badge>
            {item.analysisTrace ? (
              <Badge tone={item.analysisTrace.source === "ai" ? "blue" : "neutral"}>
                {item.analysisTrace.source === "ai"
                  ? "智能分析"
                  : item.analysisTrace.source === "seed"
                    ? "示例分析"
                    : "内置规则分析"}
              </Badge>
            ) : null}
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-950 sm:text-xl">
            <Link href={projectHref} className="hover:text-teal-700">
              {repo.fullName}
            </Link>
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{projectSummary(item)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-xs font-medium text-slate-500 sm:pt-1">
          <span className="inline-flex items-center gap-1.5">
            <Star size={14} /> {formatNumber(repo.stars)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GitFork size={14} /> {formatNumber(repo.forks)}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <section className="rounded-lg bg-teal-50/80 p-4">
          <div className="text-xs font-semibold text-teal-700">为什么推荐</div>
          <ul className="mt-2 grid gap-2 text-sm leading-6 text-teal-950">
            {learningReasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500">Mini 复刻重点</div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
              <Clock3 size={13} /> {effortLabel(analysis.difficulty)}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-800">{analysis.miniCloneScope.goal}</p>
          {coreFeatures.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {coreFeatures.map((feature) => (
                <Badge key={feature} tone="blue">
                  {feature}
                </Badge>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={learningHref}
            className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-700 bg-teal-700 px-4 text-sm font-semibold !text-white transition hover:border-teal-800 hover:bg-teal-800 hover:!text-white"
          >
            {hasStudyPlan ? "继续学习" : "开始学习"}
            <ArrowRight size={15} />
          </Link>
          <Link
            href={projectHref}
            className="focus-ring inline-flex min-h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            项目详情
          </Link>
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex min-h-10 items-center justify-center gap-1.5 px-2 text-sm font-medium text-slate-500 transition hover:text-slate-800"
          >
            GitHub <ArrowUpRight size={14} />
          </a>
        </div>
        <FeedbackControls repoId={repo.id} />
      </div>

      <details className="mt-4 border-t border-slate-100 pt-3 text-sm">
        <summary className="focus-ring cursor-pointer rounded-sm py-1 font-medium text-slate-500 hover:text-slate-800">
          查看 README 摘录、完整推荐依据与评分
        </summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="grid gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-500">README 清洗摘录</div>
              <div className="mt-1 text-xs text-slate-400">已隐藏徽章、图片地址和冗长链接</div>
              <p className="mt-1 text-sm leading-6 text-slate-700">{summarizeProject(item)}</p>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">完整推荐依据</div>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {fullReasons.map((reason) => (
                  <li key={reason} className="rounded-md bg-slate-50 px-3 py-2 text-slate-600">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{analysis.projectType}</Badge>
              {analysis.learningTags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </div>
          <ScoreBars score={score} />
        </div>
      </details>
    </article>
  );
}

function summarizeProject(item: RadarRecommendation) {
  const source = item.repo.readmeExcerpt || item.repo.description || item.analysis.oneLineSummary;
  return truncateText(sanitizeReadmeExcerpt(source, 500), 320);
}

function projectSummary(item: RadarRecommendation) {
  const summary = sanitizeReadmeExcerpt(item.analysis.oneLineSummary, 220);
  if (summary) return truncateText(summary, 180);

  const fallback = sanitizeReadmeExcerpt(item.repo.description || item.repo.readmeExcerpt, 220);
  return fallback || `${item.repo.fullName} 的项目证据不足，需要先查看 README 再确定学习范围。`;
}

function effortLabel(difficulty: string) {
  if (difficulty === "beginner") return "建议 3 天起步";
  if (difficulty === "advanced") return "建议 14 天拆解";
  return "建议 7 天完成";
}

function truncateText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function difficultyLabel(value: string) {
  if (value === "beginner") return "入门";
  if (value === "advanced") return "进阶";
  return "中级";
}
