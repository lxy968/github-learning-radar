import { Octokit } from "@octokit/rest";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { classifyOperationalError, withOperationalRetry } from "@/lib/operational-errors";
import { createUnknownEnrichmentSignals } from "@/lib/repository-signals";
import type { RepoSnapshot } from "@/lib/types";

export type DiscoveryQuery = {
  key: string;
  query: string;
  sort: "stars" | "updated";
};

export type DiscoveryResult = {
  source: "seed" | "github";
  message: string;
  repositories: RepoSnapshot[];
  warnings?: string[];
  metrics: {
    queryCount: number;
    failedQueryCount: number;
    enrichedRepositoryCount: number;
  };
};

export function buildDiscoveryQueries(referenceDate = new Date(), windowDays = 120): DiscoveryQuery[] {
  const safeWindowDays = Math.max(7, Math.min(730, Math.round(windowDays)));
  const since = new Date(referenceDate);
  since.setUTCDate(since.getUTCDate() - safeWindowDays);
  const pushedSince = since.toISOString().slice(0, 10);

  return [
    {
      key: "new-ai-tools",
      query: `topic:ai pushed:>=${pushedSince} stars:>50 fork:false archived:false is:public`,
      sort: "stars"
    },
    {
      key: "typescript-devtools",
      query: `language:TypeScript topic:devtools pushed:>=${pushedSince} stars:>30 fork:false archived:false is:public`,
      sort: "updated"
    },
    {
      key: "cloneable-cli",
      query: `topic:cli pushed:>=${pushedSince} stars:20..5000 fork:false archived:false is:public`,
      sort: "stars"
    },
    {
      key: "database-learning",
      query: `topic:database pushed:>=${pushedSince} stars:>50 fork:false archived:false is:public`,
      sort: "updated"
    }
  ];
}

export async function discoverGithubCandidates(token = process.env.GITHUB_TOKEN): Promise<DiscoveryResult> {
  if (!token) {
    return {
      source: "seed",
      message: "GITHUB_TOKEN is not configured; using seed radar data for the MVP.",
      repositories: [] as RepoSnapshot[],
      metrics: { queryCount: 0, failedQueryCount: 0, enrichedRepositoryCount: 0 }
    };
  }

  const requestTimeoutMs = readBoundedInteger(process.env.GITHUB_REQUEST_TIMEOUT_MS, 10_000, 3_000, 60_000);
  const octokit = new Octokit({
    auth: token,
    request: { timeout: requestTimeoutMs }
  });
  const seen = new Set<number>();
  const repositories: RepoSnapshot[] = [];
  const perPage = readBoundedInteger(process.env.GITHUB_SEARCH_PER_PAGE, 12, 5, 100);
  const discoveryWindowDays = readBoundedInteger(process.env.GITHUB_DISCOVERY_WINDOW_DAYS, 120, 7, 730);
  const enrichLimit = readBoundedInteger(process.env.GITHUB_ENRICH_LIMIT, 12, 0, 80);
  const enrichConcurrency = readBoundedInteger(process.env.GITHUB_ENRICH_CONCURRENCY, 4, 1, 8);
  const warnings: string[] = [];
  let successfulQueries = 0;
  const discoveryQueries = buildDiscoveryQueries(new Date(), discoveryWindowDays);

  const queryResults = await Promise.all(
    discoveryQueries.map(async (query) => {
      try {
        const response = await withOperationalRetry(
          () =>
            octokit.search.repos({
              q: query.query,
              sort: query.sort,
              order: "desc",
              per_page: perPage
            }),
          { system: "github", maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 3_000 }
        );

        return { query, response };
      } catch (error) {
        return { query, error };
      }
    })
  );

  for (const result of queryResults) {
    if ("error" in result) {
      const classified = classifyOperationalError(result.error, { system: "github" });
      warnings.push(`GitHub search query "${result.query.key}" failed [${classified.category}]: ${classified.summary}`);
      continue;
    }

    const response = result.response;

    successfulQueries += 1;

    for (const item of response.data.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      repositories.push({
        id: item.id,
        fullName: item.full_name,
        owner: item.owner?.login ?? "unknown",
        name: item.name,
        description: item.description ?? "",
        url: item.html_url,
        homepage: item.homepage ?? undefined,
        topics: item.topics ?? [],
        category: inferCategory(item.topics ?? [], item.language ?? ""),
        primaryLanguage: item.language ?? "Unknown",
        languages: item.language ? [{ name: item.language, bytes: 1 }] : [],
        stars: item.stargazers_count ?? 0,
        forks: item.forks_count ?? 0,
        openIssues: item.open_issues_count ?? 0,
        license: item.license?.spdx_id ?? null,
        createdAt: item.created_at ?? new Date().toISOString(),
        updatedAt: item.updated_at ?? new Date().toISOString(),
        pushedAt: item.pushed_at ?? item.updated_at ?? new Date().toISOString(),
        readmeExcerpt: "",
        detectedFiles: [],
        hasTests: false,
        hasExamples: false,
        hasCi: false,
        hasDocker: false,
        enrichment: createUnknownEnrichmentSignals(),
        dependencies: [],
        dailyStarDelta: 0,
        weeklyStarDelta: 0,
        sizeKb: item.size ?? 0
      });
    }
  }

  if (successfulQueries === 0) {
    return {
      source: "seed",
      message: "All GitHub search queries failed; using seed radar data.",
      warnings,
      repositories: [],
      metrics: {
        queryCount: discoveryQueries.length,
        failedQueryCount: warnings.length,
        enrichedRepositoryCount: 0
      }
    };
  }

  const enrichedRepositories = await enrichRepositories(octokit, repositories, enrichLimit, enrichConcurrency);

  return {
    source: "github",
    message: `Discovered ${repositories.length} unique GitHub repositories; enriched ${Math.min(
      repositories.length,
      enrichLimit
    )}.${warnings.length > 0 ? ` ${warnings.length} query warning(s).` : ""}`,
    repositories: enrichedRepositories,
    warnings,
    metrics: {
      queryCount: discoveryQueries.length,
      failedQueryCount: warnings.length,
      enrichedRepositoryCount: Math.min(repositories.length, enrichLimit)
    }
  };
}

async function enrichRepositories(octokit: Octokit, repositories: RepoSnapshot[], limit: number, concurrency: number) {
  const targets = repositories.slice(0, limit);
  const enriched = new Array<RepoSnapshot>(targets.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const index = nextIndex;
      nextIndex += 1;
      const repo = targets[index];

      try {
        enriched[index] = await enrichRepository(octokit, repo);
      } catch {
        enriched[index] = repo;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));

  return [...enriched, ...repositories.slice(limit)];
}

async function enrichRepository(octokit: Octokit, repo: RepoSnapshot): Promise<RepoSnapshot> {
  const owner = repo.owner;
  const repoName = repo.name;
  const [languagesResult, readmeResult, rootResult] = await Promise.allSettled([
    octokit.repos.listLanguages({ owner, repo: repoName }),
    octokit.repos.getReadme({ owner, repo: repoName }),
    octokit.repos.getContent({ owner, repo: repoName, path: "" })
  ]);

  const languages =
    languagesResult.status === "fulfilled"
      ? Object.entries(languagesResult.value.data)
          .map(([name, bytes]) => ({ name, bytes: Number(bytes) }))
          .sort((a, b) => b.bytes - a.bytes)
      : repo.languages;
  const rootFiles = rootResult.status === "fulfilled" ? extractRootFileNames(rootResult.value.data) : [];
  const detectedFiles = Array.from(new Set([...rootFiles, ...repo.detectedFiles]));
  const readmeExcerpt =
    readmeResult.status === "fulfilled" ? extractReadmeExcerpt(readmeResult.value.data) : repo.readmeExcerpt;
  const primaryLanguage = languages[0]?.name ?? repo.primaryLanguage;
  const previousSignals = repo.enrichment ?? createUnknownEnrichmentSignals();
  const testsPresent = hasAnyFile(detectedFiles, ["test", "tests", "__tests__", "vitest", "jest", "pytest"]);
  const examplesPresent = hasAnyFile(detectedFiles, ["example", "examples", "demo", "samples"]);
  const ciPresent = hasAnyFile(detectedFiles, [".github", ".gitlab-ci", "circleci", "azure-pipelines"]);
  const dockerPresent = hasAnyFile(detectedFiles, ["dockerfile", "docker-compose"]);
  const rootAvailable = rootResult.status === "fulfilled";
  const enrichment = {
    languages:
      languagesResult.status === "fulfilled" ? (languages.length > 0 ? "present" : "absent") : previousSignals.languages,
    readme:
      readmeResult.status === "fulfilled"
        ? "present"
        : isNotFoundError(readmeResult.reason)
          ? "absent"
          : previousSignals.readme,
    rootFiles: rootAvailable ? (rootFiles.length > 0 ? "present" : "absent") : previousSignals.rootFiles,
    tests: rootAvailable ? (testsPresent ? "present" : "absent") : previousSignals.tests,
    examples: rootAvailable ? (examplesPresent ? "present" : "absent") : previousSignals.examples,
    ci: rootAvailable ? (ciPresent ? "present" : "absent") : previousSignals.ci,
    docker: rootAvailable ? (dockerPresent ? "present" : "absent") : previousSignals.docker
  } as const;

  return {
    ...repo,
    primaryLanguage,
    languages,
    category: inferCategory(repo.topics, primaryLanguage),
    readmeExcerpt,
    detectedFiles,
    hasTests: enrichment.tests === "present",
    hasExamples: enrichment.examples === "present",
    hasCi: enrichment.ci === "present",
    hasDocker: enrichment.docker === "present",
    enrichment,
    dependencies: inferDependencySignals(detectedFiles)
  };
}

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; statusCode?: unknown };
  return Number(record.status ?? record.statusCode) === 404;
}

function extractRootFileNames(data: unknown) {
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
        return item.name;
      }

      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function extractReadmeExcerpt(data: unknown) {
  if (!data || typeof data !== "object" || !("content" in data) || typeof data.content !== "string") {
    return "";
  }

  const text = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  return sanitizeReadmeExcerpt(text);
}

function hasAnyFile(files: string[], needles: string[]) {
  const bag = files.join(" ").toLowerCase();
  return needles.some((needle) => bag.includes(needle));
}

function inferDependencySignals(files: string[]) {
  const lowerFiles = files.map((file) => file.toLowerCase());
  const signals = [
    ["package.json", "node"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["cargo.toml", "rust"],
    ["go.mod", "go"],
    ["composer.json", "php"],
    ["gemfile", "ruby"],
    ["dockerfile", "docker"]
  ] as const;

  return signals.filter(([file]) => lowerFiles.includes(file)).map(([, signal]) => signal);
}

function inferCategory(topics: string[], language: string) {
  const bag = `${topics.join(" ")} ${language}`.toLowerCase();

  if (bag.includes("ai") || bag.includes("agent") || bag.includes("mcp")) return "ai-app";
  if (bag.includes("database") || bag.includes("postgres")) return "database";
  if (bag.includes("cli")) return "cli";
  if (bag.includes("devtool") || bag.includes("lsp")) return "devtool";
  if (bag.includes("next") || bag.includes("react")) return "frontend";

  return "fullstack";
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
