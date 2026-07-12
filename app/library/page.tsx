import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getCurrentRecommendations } from "@/lib/radar";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const items = await getCurrentRecommendations();

  return (
    <AppShell>
      <PageHeader
        eyebrow="Library"
        title="项目库"
        description="MVP 项目池展示已标准化的候选仓库。后续这里会接 GitHub API 抓取和数据库筛选。"
      />
      <div className="px-5 py-5 lg:px-8">
        <Panel className="overflow-hidden">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">项目</th>
                <th className="px-4 py-3">语言</th>
                <th className="px-4 py-3">Stars</th>
                <th className="px-4 py-3">雷达分</th>
                <th className="px-4 py-3">标签</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const [owner, repo] = item.repo.fullName.split("/");
                return (
                  <tr key={item.repo.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <Link href={`/projects/${owner}/${repo}`} className="font-medium text-slate-950 hover:text-teal-700">
                        {item.repo.fullName}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{item.repo.description}</div>
                    </td>
                    <td className="px-4 py-3">{item.repo.primaryLanguage}</td>
                    <td className="px-4 py-3">{formatNumber(item.repo.stars)}</td>
                    <td className="px-4 py-3">{item.score.finalScore}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {item.analysis.learningTags.slice(0, 3).map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </AppShell>
  );
}
