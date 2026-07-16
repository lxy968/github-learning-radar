import { AppShell } from "@/components/app-shell";
import { BookmarkedRoutesBoard } from "@/components/bookmarked-routes-board";
import { PageHeader } from "@/components/page-header";
import { listCurrentDetailedStudyPlans } from "@/lib/detailed-study-plans";
import { listBookmarkedRecommendations } from "@/lib/user-state";
import { getCurrentAnonymousUserId } from "@/lib/anonymous-session";
import { getUserPreference } from "@/lib/preferences";
import { isShowcaseMode } from "@/lib/deployment-mode";

export const dynamic = "force-dynamic";

export default async function RoutesPage() {
  const showcaseMode = isShowcaseMode();
  const userId = await getCurrentAnonymousUserId();
  const [bookmarks, preference] = await Promise.all([
    listBookmarkedRecommendations(userId),
    getUserPreference(userId)
  ]);
  const detailedPlans = await listCurrentDetailedStudyPlans(bookmarks, preference);

  return (
    <AppShell>
      <PageHeader
        eyebrow="学习路线"
        title="收藏项目学习路线"
        description="这里不再放随机推荐，只展示你收藏的项目路线，并按当前匿名会话同步后的步骤完成度排行。"
      />
      <div className="px-5 py-5 lg:px-8">
        <BookmarkedRoutesBoard items={bookmarks} detailedPlans={detailedPlans} showcaseMode={showcaseMode} />
      </div>
    </AppShell>
  );
}
