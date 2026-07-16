import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, GitFork, Sparkles, Star } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { FeedbackControls } from "@/components/feedback-controls";
import { PageHeader } from "@/components/page-header";
import { ScoreBars } from "@/components/score-bars";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getCurrentRecommendation } from "@/lib/radar";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { uniqueTextValues } from "@/lib/text-lists";
import { formatDate, formatNumber } from "@/lib/utils";
import { isShowcaseMode } from "@/lib/deployment-mode";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const showcaseMode = isShowcaseMode();
  const item = await getCurrentRecommendation(owner, repo);

  if (!item) notFound();

  const { repo: snapshot, score, analysis } = item;
  const whyLearn = uniqueTextValues(analysis.whyLearn);
  const coreFeatures = uniqueTextValues(analysis.miniCloneScope.coreFeatures);
  const excludedFeatures = uniqueTextValues(analysis.miniCloneScope.excludedFeatures);
  const risks = uniqueTextValues([...score.risks, ...analysis.risks]).slice(0, 5);
  const readmeSummary = sanitizeReadmeExcerpt(snapshot.readmeExcerpt || snapshot.description, 900);
  const learningPlanHref = `/projects/${encodeURIComponent(snapshot.owner)}/${encodeURIComponent(snapshot.name)}/learning-plan`;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Project detail"
        title={snapshot.fullName}
        description={analysis.oneLineSummary}
        actions={
          <>
            <Link
              href="/"
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={15} aria-hidden="true" />
              返回雷达
            </Link>
            <a
              href={snapshot.url}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
            >
              <ArrowUpRight size={15} aria-hidden="true" />
              GitHub
            </a>
          </>
        }
      />

      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_340px] lg:px-8">
        <div className="grid gap-5">
          <Panel className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">雷达分 {score.finalScore}</Badge>
              <Badge>{snapshot.primaryLanguage}</Badge>
              <Badge tone="blue">{analysis.projectType}</Badge>
              <Badge tone="amber">置信度 {Math.round(analysis.confidence * 100)}%</Badge>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-700">
              {readmeSummary || "当前没有 README 摘要，建议先打开 GitHub 仓库确认细节。"}
            </p>
            <div className="mt-5 grid gap-3 text-sm lg:grid-cols-3">
              <Metric label="Stars" value={formatNumber(snapshot.stars)} icon={Star} />
              <Metric label="Forks" value={formatNumber(snapshot.forks)} icon={GitFork} />
              <Metric label="最近更新" value={formatDate(snapshot.pushedAt)} icon={CheckCircle2} />
            </div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-base font-semibold text-slate-950">为什么值得学</h2>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {whyLearn.map((reason, index) => (
                <div key={`why-${index}-${reason}`} className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                  {reason}
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-base font-semibold text-slate-950">Mini 复刻方案</h2>
            <p className="mt-2 text-sm text-slate-600">{analysis.miniCloneScope.goal}</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">核心功能</h3>
                <ul className="mt-2 grid gap-2 text-sm text-slate-600">
                  {coreFeatures.map((feature, index) => (
                    <li key={`core-${index}-${feature}`} className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">明确不做</h3>
                <ul className="mt-2 grid gap-2 text-sm text-slate-600">
                  {excludedFeatures.map((feature, index) => (
                    <li key={`excluded-${index}-${feature}`} className="rounded-md bg-slate-50 px-3 py-2">
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 text-teal-700">
                  <Sparkles size={17} aria-hidden="true" />
                  <span className="text-xs font-semibold uppercase tracking-wide">{showcaseMode ? "公开预置体验" : "按需生成"}</span>
                </div>
                <h2 className="mt-2 text-base font-semibold text-slate-950">
                  {showcaseMode ? "查看仓库专属的预置学习方案" : "生成仓库专属的具体学习方案"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {showcaseMode
                    ? "公开站提前准备学习步骤，不会现场调用 DeepSeek。你可以查看方案、勾选步骤并刷新确认进度。"
                    : "选择 3、7 或 14 天路线后，再根据 README、技术栈和仓库文件生成具体操作、验证标准与交付物。只分析当前项目，生成结果会缓存，重新打开不会重复消耗 AI Token。"}
                </p>
              </div>
              <Link
                href={learningPlanHref}
                className="focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-teal-700 bg-teal-700 px-4 text-sm font-medium text-white transition hover:border-teal-800 hover:bg-teal-800"
              >
                {showcaseMode ? "查看预置学习方案" : "生成具体学习方案"}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </Panel>
        </div>

        <aside className="grid content-start gap-4">
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-slate-950">学习信号</h2>
            <div className="mt-4">
              <ScoreBars score={score} />
            </div>
          </Panel>
          <AnalysisSourcePanel trace={item.analysisTrace} />
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-slate-950">反馈</h2>
            <p className="mt-2 text-sm text-slate-600">
              反馈只写入当前匿名会话的本地 `.data` 或 Postgres 数据，用于后续调整个人推荐权重。
            </p>
            <div className="mt-4">
              <FeedbackControls repoId={snapshot.id} />
            </div>
          </Panel>
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-slate-950">风险提示</h2>
            <ul className="mt-3 grid gap-2 text-sm text-slate-600">
              {risks.map((risk, index) => (
                <li key={`risk-${index}-${risk}`} className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                  {risk}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}

function AnalysisSourcePanel({ trace }: { trace: NonNullable<Awaited<ReturnType<typeof getCurrentRecommendation>>>["analysisTrace"] }) {
  const attempt = trace?.providerAttempts[0];
  const succeeded = attempt?.status === "success";

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-950">分析方式</h2>
        <Badge tone={succeeded ? "blue" : trace ? "amber" : "neutral"}>
          {succeeded ? "智能分析" : trace ? "内置规则" : "历史记录"}
        </Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{analysisSourceDescription(trace)}</p>
    </Panel>
  );
}

function analysisSourceDescription(
  trace: NonNullable<Awaited<ReturnType<typeof getCurrentRecommendation>>>["analysisTrace"]
) {
  if (!trace) return "这条历史推荐生成时尚未记录分析方式。";
  const attempt = trace.providerAttempts[0];
  if (attempt?.status === "success") return "已根据仓库说明、技术栈和工程信号完成智能分析。";
  if (attempt?.status === "failed") {
    return "智能分析服务未能完成本次任务，已自动切换为内置规则分析。";
  }
  if (trace.fallbackReason === "not-configured") return "未配置智能分析服务，本次直接使用内置规则，没有发起模型调用。";
  return "本项目未进入本轮智能分析额度，直接使用内置规则，没有消耗模型 Token。";
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Star;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <Icon size={16} className="text-teal-700" aria-hidden="true" />
      <div className="mt-2 text-lg font-semibold text-slate-950">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
