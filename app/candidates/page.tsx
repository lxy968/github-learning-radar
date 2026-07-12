import { AppShell } from "@/components/app-shell";
import { CandidateRepositoryBrowser } from "@/components/candidate-repository-browser";
import { PageHeader } from "@/components/page-header";
import { RadarPipelinePanel } from "@/components/radar-pipeline-panel";
import { Badge } from "@/components/ui/badge";
import {
  paginateRepositoryCandidates,
  searchRepositoryCandidates,
  type CandidateSort
} from "@/lib/repository-store";
import { seedRepos } from "@/lib/seed-data";
import type { RadarCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = readSearchParam(params.q).trim().slice(0, 120);
  const category = parseCategory(readSearchParam(params.category));
  const sort = parseSort(readSearchParam(params.sort));
  const page = Math.max(1, Math.round(Number(readSearchParam(params.page)) || 1));
  const options = { query, category, sort, page, pageSize: 12 } as const;
  const storedResult = await searchRepositoryCandidates(options);
  const source = storedResult.sourceTotal > 0 ? "local" : "seed";
  const candidateResult = source === "local" ? storedResult : paginateRepositoryCandidates(seedRepos, options);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Candidate pool"
        title="GitHub 候选项目"
        description="这里展示 GitHub discovery 抓到但不一定进入最终雷达的仓库，可以搜索、筛选并进入详情查看。"
        actions={
          <Badge tone={source === "local" ? "green" : "amber"}>{candidateResult.sourceTotal} 个候选</Badge>
        }
      />
      <div className="grid gap-5 px-5 py-5 lg:px-8">
        <RadarPipelinePanel candidateCount={candidateResult.sourceTotal} source={source} />
        <CandidateRepositoryBrowser
          {...candidateResult}
          query={query}
          category={category}
          sort={sort}
        />
      </div>
    </AppShell>
  );
}

function readSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parseCategory(value: string): "all" | RadarCategory {
  if (
    value === "ai-app" ||
    value === "frontend" ||
    value === "backend" ||
    value === "devtool" ||
    value === "database" ||
    value === "automation" ||
    value === "cli" ||
    value === "fullstack"
  ) {
    return value;
  }

  return "all";
}

function parseSort(value: string): CandidateSort {
  return value === "recent" || value === "name" ? value : "stars";
}
