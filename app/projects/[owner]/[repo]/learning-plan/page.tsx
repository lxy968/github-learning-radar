import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DetailedStudyPlanBuilder } from "@/components/detailed-study-plan-builder";
import { PageHeader } from "@/components/page-header";
import { listCurrentDetailedStudyPlans } from "@/lib/detailed-study-plans";
import { getCurrentRecommendation } from "@/lib/radar";
import { getCurrentAnonymousUserId } from "@/lib/anonymous-session";
import { getUserPreference } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function DetailedLearningPlanPage({
  params
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const recommendation = await getCurrentRecommendation(owner, repo);
  if (!recommendation) notFound();

  const userId = await getCurrentAnonymousUserId();
  const preference = await getUserPreference(userId);
  const plans = await listCurrentDetailedStudyPlans([recommendation], preference);
  const projectHref = `/projects/${encodeURIComponent(recommendation.repo.owner)}/${encodeURIComponent(recommendation.repo.name)}`;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Detailed learning plan"
        title={`${recommendation.repo.fullName} 具体学习方案`}
        description="按需生成仓库专属的操作步骤；每一步都有依据、验证方法和交付物，完成后点亮圆圈。"
        actions={
          <>
            <Link
              href={projectHref}
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={15} />
              返回项目详情
            </Link>
            <a
              href={recommendation.repo.url}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
            >
              <ArrowUpRight size={15} />
              GitHub
            </a>
          </>
        }
      />

      <div className="px-5 py-5 lg:px-8">
        <DetailedStudyPlanBuilder
          owner={recommendation.repo.owner}
          repo={recommendation.repo.name}
          projectName={recommendation.repo.fullName}
          language={recommendation.repo.primaryLanguage}
          cloneGoal={recommendation.analysis.miniCloneScope.goal}
          learnerLevel={preference.level}
          learnerGoal={preference.goal}
          initialPlans={plans}
        />
      </div>
    </AppShell>
  );
}
