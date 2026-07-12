import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FileCode2, GitFork, Star } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getCurrentRecommendation } from "@/lib/radar";
import { getRepositoryCandidate } from "@/lib/repository-store";
import { seedRepos } from "@/lib/seed-data";
import { formatNumber } from "@/lib/utils";
import { getRepoSignal } from "@/lib/repository-signals";
import { RepositorySignalBadge } from "@/components/repository-signal-badge";

export const dynamic = "force-dynamic";

export default async function CandidateDetailPage({
  params
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`.toLowerCase();
  const [storedCandidate, recommendation] = await Promise.all([
    getRepositoryCandidate(owner, repo),
    getCurrentRecommendation(owner, repo)
  ]);
  const candidate = storedCandidate ?? seedRepos.find((item) => item.fullName.toLowerCase() === fullName);

  if (!candidate) notFound();

  return (
    <AppShell>
      <PageHeader
        eyebrow="Candidate detail"
        title={candidate.fullName}
        description={candidate.description || "这个候选仓库暂时没有描述。"}
        actions={
          <>
            <Link
              href="/candidates"
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={15} /> 返回候选池
            </Link>
            <a
              href={candidate.url}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800"
            >
              <ArrowUpRight size={15} /> GitHub
            </a>
          </>
        }
      />

      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_320px] lg:px-8">
        <main className="grid gap-5">
          <Panel className="p-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone="blue">{candidate.category}</Badge>
              <Badge>{candidate.primaryLanguage}</Badge>
              {candidate.license ? <Badge tone="green">{candidate.license}</Badge> : <Badge tone="amber">无许可证信号</Badge>}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric icon={Star} label="Stars" value={formatNumber(candidate.stars)} />
              <Metric icon={GitFork} label="Forks" value={formatNumber(candidate.forks)} />
              <Metric icon={FileCode2} label="仓库大小" value={`${formatNumber(candidate.sizeKb)} KB`} />
            </div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-base font-semibold text-slate-950">README 摘要</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {candidate.readmeExcerpt || signalEmptyText(getRepoSignal(candidate, "readme"), "README")}
            </p>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-base font-semibold text-slate-950">发现信号</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <SignalList title="Topics" items={candidate.topics} empty="没有 topic" />
              <SignalList title="依赖生态" items={candidate.dependencies} empty="没有识别到依赖文件" />
              <SignalList title="根目录文件" items={candidate.detectedFiles} empty={signalEmptyText(getRepoSignal(candidate, "rootFiles"), "根目录文件")} />
              <SignalList title="语言" items={candidate.languages.map((item) => item.name)} empty={signalEmptyText(getRepoSignal(candidate, "languages"), "语言统计")} />
            </div>
          </Panel>
        </main>

        <aside className="grid content-start gap-4">
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-slate-950">工程信号</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <RepositorySignalBadge label="测试" state={getRepoSignal(candidate, "tests")} />
              <RepositorySignalBadge label="示例" state={getRepoSignal(candidate, "examples")} />
              <RepositorySignalBadge label="CI" state={getRepoSignal(candidate, "ci")} />
              <RepositorySignalBadge label="Docker" state={getRepoSignal(candidate, "docker")} />
            </div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-slate-950">AI 分析状态</h2>
            {recommendation ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600">这个候选已经进入当前雷达，并完成 DeepSeek 或规则 fallback 分析。</p>
                <Link
                  href={`/projects/${encodeURIComponent(candidate.owner)}/${encodeURIComponent(candidate.name)}`}
                  className="mt-4 inline-flex text-sm font-medium text-teal-700 hover:text-teal-800"
                >
                  查看学习方案
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                这个仓库目前只是候选，还没有进入本轮最高分项目，因此不会消耗 AI 调用。
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}

function SignalList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length > 0 ? items.slice(0, 20).map((item) => <Badge key={item}>{item}</Badge>) : <span className="text-sm text-slate-500">{empty}</span>}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Star; label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <Icon size={16} className="text-teal-700" />
      <div className="mt-2 text-lg font-semibold text-slate-950">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function signalEmptyText(state: ReturnType<typeof getRepoSignal>, label: string) {
  return state === "absent" ? `已检查，未发现${label}` : `尚未成功读取${label}，状态未知`;
}
