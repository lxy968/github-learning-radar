import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { PreferenceForm } from "@/components/preference-form";
import { AnonymousDataControls } from "@/components/anonymous-data-controls";
import { getUserPreference } from "@/lib/preferences";
import { getCurrentAnonymousUserId } from "@/lib/anonymous-session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const userId = await getCurrentAnonymousUserId();
  const preference = await getUserPreference(userId);

  return (
    <AppShell>
      <PageHeader
        eyebrow="偏好设置"
        title="兴趣设置"
        description="配置当前匿名会话的技术方向、学习水平和目标。公共雷达内容不变，但首页排序会按你的偏好调整。"
      />
      <div className="px-5 py-5 lg:px-8">
        <PreferenceForm initialPreference={preference} />
        <AnonymousDataControls />
      </div>
    </AppShell>
  );
}
