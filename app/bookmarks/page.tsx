import { Bookmark } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { RecommendationCard } from "@/components/recommendation-card";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { listBookmarkedRecommendations } from "@/lib/user-state";
import { getCurrentAnonymousUserId } from "@/lib/anonymous-session";
import { listCurrentDetailedStudyPlans } from "@/lib/detailed-study-plans";
import { getUserPreference } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function BookmarksPage() {
  const userId = await getCurrentAnonymousUserId();
  const [bookmarks, preference] = await Promise.all([
    listBookmarkedRecommendations(userId),
    getUserPreference(userId)
  ]);
  const plans = await listCurrentDetailedStudyPlans(bookmarks, preference);
  const planRepoIds = new Set(plans.map((plan) => plan.repoId));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Bookmarks"
        title="收藏与稍后学"
        description="这里展示当前匿名会话收藏的项目。浏览器之间默认互不共享，正式部署后数据保存在 Postgres。"
      />
      <div className="grid gap-4 px-5 py-5 lg:px-8">
        {bookmarks.length > 0 ? (
          bookmarks.map((item) => (
            <RecommendationCard key={item.repo.id} item={item} hasStudyPlan={planRepoIds.has(item.repo.id)} />
          ))
        ) : (
          <Panel className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-600">
              <Bookmark size={20} />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-950">还没有收藏项目</h2>
            <p className="mt-2 text-sm text-slate-600">从今日雷达点“收藏”后，这里会变成你的学习队列。</p>
            <a href="/" className="mt-5 inline-flex">
              <Button variant="primary">回到今日雷达</Button>
            </a>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
