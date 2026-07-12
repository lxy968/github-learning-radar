import Link from "next/link";
import { GitFork, Search, Star } from "lucide-react";
import { RepositorySignalBadge } from "@/components/repository-signal-badge";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getRepoSignal } from "@/lib/repository-signals";
import type { CandidateSearchResult, CandidateSort } from "@/lib/repository-store";
import type { RadarCategory, RepoSnapshot } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

const categoryLabels: Record<RadarCategory, string> = {
  "ai-app": "AI 应用",
  frontend: "前端",
  backend: "后端",
  devtool: "开发者工具",
  database: "数据库",
  automation: "自动化",
  cli: "CLI",
  fullstack: "全栈"
};

type CandidateRepositoryBrowserProps = CandidateSearchResult & {
  query: string;
  category: "all" | RadarCategory;
  sort: CandidateSort;
};

export function CandidateRepositoryBrowser({
  items,
  total,
  page,
  pageSize,
  totalPages,
  query,
  category,
  sort
}: CandidateRepositoryBrowserProps) {
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="grid gap-4" data-testid="candidate-browser">
      <Panel className="p-4">
        <form
          action="/candidates"
          method="get"
          className="grid gap-3 lg:grid-cols-[1fr_190px_180px_auto] lg:items-center"
        >
          <label className="relative block">
            <span className="sr-only">搜索候选仓库</span>
            <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={16} />
            <input
              name="q"
              defaultValue={query}
              className="focus-ring h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800"
              placeholder="搜索仓库、语言或 topic"
            />
          </label>
          <select
            name="category"
            defaultValue={category}
            className="focus-ring h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
            aria-label="候选项目分类"
          >
            <option value="all">全部分类</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            name="sort"
            defaultValue={sort}
            className="focus-ring h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
            aria-label="候选项目排序"
          >
            <option value="stars">Stars 从高到低</option>
            <option value="recent">最近更新优先</option>
            <option value="name">仓库名称排序</option>
          </select>
          <button className="focus-ring h-10 rounded-md bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">
            应用筛选
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <Badge tone="green">显示 {rangeStart}-{rangeEnd} / {total}</Badge>
          <span>筛选与排序在服务端执行，浏览器只接收当前页。</span>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2" data-testid="candidate-list">
        {items.map((item) => (
          <Panel key={item.id} className="flex h-full flex-col p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{categoryLabels[item.category]}</Badge>
              <Badge>{item.primaryLanguage}</Badge>
              <RepositorySignalBadge label="测试" state={getRepoSignal(item, "tests")} />
              <RepositorySignalBadge label="示例" state={getRepoSignal(item, "examples")} />
              <RepositorySignalBadge label="CI" state={getRepoSignal(item, "ci")} />
            </div>
            <div className="mt-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-950">{item.fullName}</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                  {item.description || "这个候选仓库暂时没有描述。"}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs text-slate-500">
                <div className="inline-flex items-center gap-1">
                  <Star size={13} /> {formatNumber(item.stars)}
                </div>
                <div className="mt-1 flex items-center justify-end gap-1">
                  <GitFork size={13} /> {formatNumber(item.forks)}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.topics.slice(0, 5).map((topic) => (
                <Badge key={topic}>{topic}</Badge>
              ))}
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span>{rootSignalSummary(item)}</span>
              <Link
                href={`/candidates/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}`}
                className="font-medium text-teal-700 hover:text-teal-800"
              >
                查看候选详情
              </Link>
            </div>
          </Panel>
        ))}
      </div>

      {items.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-slate-600">没有符合当前搜索条件的候选项目。</Panel>
      ) : null}

      {total > 0 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="候选项目分页">
          {page > 1 ? (
            <Link
              href={candidatePageHref({ query, category, sort, page: page - 1 })}
              className="focus-ring inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              上一页
            </Link>
          ) : (
            <span className="inline-flex h-10 items-center rounded-md border border-slate-100 bg-slate-50 px-4 text-sm text-slate-400">
              上一页
            </span>
          )}
          <span className="text-sm text-slate-600">第 {page} / {totalPages} 页</span>
          {page < totalPages ? (
            <Link
              href={candidatePageHref({ query, category, sort, page: page + 1 })}
              className="focus-ring inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              下一页
            </Link>
          ) : (
            <span className="inline-flex h-10 items-center rounded-md border border-slate-100 bg-slate-50 px-4 text-sm text-slate-400">
              下一页
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}

function rootSignalSummary(repo: RepoSnapshot) {
  const state = getRepoSignal(repo, "rootFiles");
  if (state === "unknown") return "根目录信号未知";
  if (state === "absent") return "已确认无根目录文件";
  return `${repo.detectedFiles.length} 个根目录信号`;
}

function candidatePageHref({
  query,
  category,
  sort,
  page
}: {
  query: string;
  category: "all" | RadarCategory;
  sort: CandidateSort;
  page: number;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category !== "all") params.set("category", category);
  if (sort !== "stars") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return queryString ? `/candidates?${queryString}` : "/candidates";
}
