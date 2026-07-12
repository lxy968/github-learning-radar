import { promises as fs } from "fs";
import path from "path";
import { getSqlClient } from "@/lib/db/client";
import { sanitizeReadmeExcerpt } from "@/lib/readme";
import { normalizeEnrichmentSignals } from "@/lib/repository-signals";
import type { RadarCategory, RepoSnapshot } from "@/lib/types";

type MetricSnapshot = {
  snapshotDate: string;
  stars: number;
  forks: number;
  openIssues: number;
  pushedAt: string;
  capturedAt: string;
};

type LocalRepositoryStore = {
  repositories: Record<string, RepoSnapshot>;
  snapshots: Record<string, MetricSnapshot[]>;
};

export type CandidateSort = "stars" | "recent" | "name";

export type CandidateSearchOptions = {
  query?: string;
  category?: "all" | RadarCategory;
  sort?: CandidateSort;
  page?: number;
  pageSize?: number;
};

export type CandidateSearchResult = {
  items: RepoSnapshot[];
  total: number;
  sourceTotal: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const dataDir = path.join(process.cwd(), ".data");

export async function persistRepositorySnapshots(repositories: RepoSnapshot[], snapshotDate = toDateKey(new Date())) {
  const sql = getSqlClient();

  if (sql) {
    const enriched: RepoSnapshot[] = [];

    for (const repo of repositories) {
      const rows = await sql`
        INSERT INTO repositories (
          github_id,
          full_name,
          owner_login,
          name,
          html_url,
          description,
          homepage,
          category,
          primary_language,
          license_spdx,
          topics,
          languages,
          readme_excerpt,
          detected_files,
          has_tests,
          has_examples,
          has_ci,
          has_docker,
          enrichment_signals,
          dependencies,
          size_kb,
          pushed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${repo.id},
          ${repo.fullName},
          ${repo.owner},
          ${repo.name},
          ${repo.url},
          ${repo.description},
          ${repo.homepage ?? null},
          ${repo.category},
          ${repo.primaryLanguage},
          ${repo.license},
          ${sql.json(repo.topics as never)},
          ${sql.json(repo.languages as never)},
          ${repo.readmeExcerpt},
          ${sql.json(repo.detectedFiles as never)},
          ${repo.hasTests},
          ${repo.hasExamples},
          ${repo.hasCi},
          ${repo.hasDocker},
          ${sql.json((repo.enrichment ?? {}) as never)},
          ${sql.json(repo.dependencies as never)},
          ${repo.sizeKb},
          ${repo.pushedAt},
          ${repo.createdAt},
          ${repo.updatedAt}
        )
        ON CONFLICT (github_id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          owner_login = EXCLUDED.owner_login,
          name = EXCLUDED.name,
          html_url = EXCLUDED.html_url,
          description = EXCLUDED.description,
          homepage = EXCLUDED.homepage,
          category = EXCLUDED.category,
          primary_language = EXCLUDED.primary_language,
          license_spdx = EXCLUDED.license_spdx,
          topics = EXCLUDED.topics,
          languages = EXCLUDED.languages,
          readme_excerpt = EXCLUDED.readme_excerpt,
          detected_files = EXCLUDED.detected_files,
          has_tests = EXCLUDED.has_tests,
          has_examples = EXCLUDED.has_examples,
          has_ci = EXCLUDED.has_ci,
          has_docker = EXCLUDED.has_docker,
          enrichment_signals = EXCLUDED.enrichment_signals,
          dependencies = EXCLUDED.dependencies,
          size_kb = EXCLUDED.size_kb,
          pushed_at = EXCLUDED.pushed_at,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
        RETURNING id
      `;
      const repoId = Number(rows[0].id);

      await sql`
        INSERT INTO repository_snapshots (
          repo_id,
          snapshot_date,
          stars,
          forks,
          open_issues,
          pushed_at
        )
        VALUES (
          ${repoId},
          ${snapshotDate},
          ${repo.stars},
          ${repo.forks},
          ${repo.openIssues},
          ${repo.pushedAt}
        )
        ON CONFLICT (repo_id, snapshot_date) DO UPDATE SET
          stars = EXCLUDED.stars,
          forks = EXCLUDED.forks,
          open_issues = EXCLUDED.open_issues,
          pushed_at = EXCLUDED.pushed_at
      `;

      const snapshots = await sql`
        SELECT snapshot_date, stars, forks, open_issues, pushed_at, created_at
        FROM repository_snapshots
        WHERE repo_id = ${repoId}
        ORDER BY snapshot_date ASC
      `;
      enriched.push(applyTrendDeltas(repo, snapshots.map(mapSnapshotRow), snapshotDate));
    }

    return enriched;
  }

  const store = await readLocalStore();
  const enriched = repositories.map((repo) => {
    const key = String(repo.id);
    const snapshots = upsertLocalSnapshot(store.snapshots[key] ?? [], repo, snapshotDate);
    store.repositories[key] = repo;
    store.snapshots[key] = snapshots;
    return applyTrendDeltas(repo, snapshots, snapshotDate);
  });

  await writeLocalStore(store);

  return enriched;
}

export async function listRepositoryCandidates(limit = 120) {
  const safeLimit = Math.max(1, Math.min(300, Math.round(limit)));
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT
        repositories.*,
        latest_snapshot.stars AS latest_stars,
        latest_snapshot.forks AS latest_forks,
        latest_snapshot.open_issues AS latest_open_issues,
        latest_snapshot.pushed_at AS snapshot_pushed_at
      FROM repositories
      LEFT JOIN LATERAL (
        SELECT stars, forks, open_issues, pushed_at
        FROM repository_snapshots
        WHERE repository_snapshots.repo_id = repositories.id
        ORDER BY snapshot_date DESC
        LIMIT 1
      ) AS latest_snapshot ON TRUE
      ORDER BY COALESCE(latest_snapshot.stars, 0) DESC, repositories.full_name ASC
      LIMIT ${safeLimit}
    `;

    return rows.map(mapRepositoryRow);
  }

  const store = await readLocalStore();
  return Object.entries(store.repositories)
    .map(([id, repo]) => {
      const snapshots = store.snapshots[id] ?? [];
      const latestSnapshot = snapshots.at(-1);
      const candidate = latestSnapshot ? applyTrendDeltas(repo, snapshots, latestSnapshot.snapshotDate) : repo;
      return normalizeRepository(candidate);
    })
    .sort((a, b) => b.stars - a.stars || a.fullName.localeCompare(b.fullName))
    .slice(0, safeLimit);
}

export async function searchRepositoryCandidates(options: CandidateSearchOptions = {}): Promise<CandidateSearchResult> {
  const normalized = normalizeCandidateSearchOptions(options);
  const sql = getSqlClient();

  if (sql) {
    const searchPattern = `%${normalized.query}%`;
    const countRows = await sql`
      SELECT
        COUNT(*) AS source_total,
        COUNT(*) FILTER (
          WHERE (
            ${normalized.query} = '' OR
            repositories.full_name ILIKE ${searchPattern} OR
            repositories.description ILIKE ${searchPattern} OR
            repositories.primary_language ILIKE ${searchPattern} OR
            repositories.topics::text ILIKE ${searchPattern}
          )
          AND (${normalized.category} = 'all' OR repositories.category = ${normalized.category})
        ) AS filtered_total
      FROM repositories
    `;
    const sourceTotal = Number(countRows[0]?.source_total ?? 0);
    const total = Number(countRows[0]?.filtered_total ?? 0);
    const page = clampCandidatePage(normalized.page, total, normalized.pageSize);
    const offset = (page - 1) * normalized.pageSize;
    const rows = await sql`
      SELECT
        repositories.*,
        latest_snapshot.stars AS latest_stars,
        latest_snapshot.forks AS latest_forks,
        latest_snapshot.open_issues AS latest_open_issues,
        latest_snapshot.pushed_at AS snapshot_pushed_at
      FROM repositories
      LEFT JOIN LATERAL (
        SELECT stars, forks, open_issues, pushed_at
        FROM repository_snapshots
        WHERE repository_snapshots.repo_id = repositories.id
        ORDER BY snapshot_date DESC
        LIMIT 1
      ) AS latest_snapshot ON TRUE
      WHERE (
        ${normalized.query} = '' OR
        repositories.full_name ILIKE ${searchPattern} OR
        repositories.description ILIKE ${searchPattern} OR
        repositories.primary_language ILIKE ${searchPattern} OR
        repositories.topics::text ILIKE ${searchPattern}
      )
      AND (${normalized.category} = 'all' OR repositories.category = ${normalized.category})
      ORDER BY
        CASE WHEN ${normalized.sort} = 'stars' THEN COALESCE(latest_snapshot.stars, 0) END DESC,
        CASE WHEN ${normalized.sort} = 'recent' THEN COALESCE(latest_snapshot.pushed_at, repositories.pushed_at) END DESC,
        CASE WHEN ${normalized.sort} = 'name' THEN repositories.full_name END ASC,
        repositories.full_name ASC
      LIMIT ${normalized.pageSize}
      OFFSET ${offset}
    `;

    return createCandidateSearchResult(rows.map(mapRepositoryRow), total, sourceTotal, page, normalized.pageSize);
  }

  const store = await readLocalStore();
  const candidates = Object.entries(store.repositories).map(([id, repo]) => {
    const snapshots = store.snapshots[id] ?? [];
    const latestSnapshot = snapshots.at(-1);
    const candidate = latestSnapshot ? applyTrendDeltas(repo, snapshots, latestSnapshot.snapshotDate) : repo;
    return normalizeRepository(candidate);
  });

  return paginateRepositoryCandidates(candidates, normalized);
}

export function paginateRepositoryCandidates(
  repositories: RepoSnapshot[],
  options: CandidateSearchOptions = {}
): CandidateSearchResult {
  const normalized = normalizeCandidateSearchOptions(options);
  const query = normalized.query.toLowerCase();
  const filtered = repositories
    .map(normalizeRepository)
    .filter((repo) => {
      if (normalized.category !== "all" && repo.category !== normalized.category) return false;
      if (!query) return true;
      return `${repo.fullName} ${repo.description} ${repo.primaryLanguage} ${repo.topics.join(" ")}`
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => compareCandidates(a, b, normalized.sort));
  const page = clampCandidatePage(normalized.page, filtered.length, normalized.pageSize);
  const offset = (page - 1) * normalized.pageSize;
  const items = filtered.slice(offset, offset + normalized.pageSize);

  return createCandidateSearchResult(items, filtered.length, repositories.length, page, normalized.pageSize);
}

export async function getRepositoryCandidate(owner: string, repoName: string) {
  const fullName = `${owner}/${repoName}`.toLowerCase();
  const sql = getSqlClient();

  if (sql) {
    const rows = await sql`
      SELECT
        repositories.*,
        latest_snapshot.stars AS latest_stars,
        latest_snapshot.forks AS latest_forks,
        latest_snapshot.open_issues AS latest_open_issues,
        latest_snapshot.pushed_at AS snapshot_pushed_at
      FROM repositories
      LEFT JOIN LATERAL (
        SELECT stars, forks, open_issues, pushed_at
        FROM repository_snapshots
        WHERE repository_snapshots.repo_id = repositories.id
        ORDER BY snapshot_date DESC
        LIMIT 1
      ) AS latest_snapshot ON TRUE
      WHERE LOWER(repositories.full_name) = ${fullName}
      LIMIT 1
    `;

    return rows[0] ? mapRepositoryRow(rows[0]) : null;
  }

  const store = await readLocalStore();
  const entry = Object.entries(store.repositories).find(([, repo]) => repo.fullName.toLowerCase() === fullName);
  if (!entry) return null;
  const [id, repo] = entry;
  const snapshots = store.snapshots[id] ?? [];
  const latestSnapshot = snapshots.at(-1);
  const candidate = latestSnapshot ? applyTrendDeltas(repo, snapshots, latestSnapshot.snapshotDate) : repo;
  return normalizeRepository(candidate);
}

async function readLocalStore(): Promise<LocalRepositoryStore> {
  try {
    const content = await fs.readFile(getRepositoryStoreFile(), "utf8");
    const parsed = JSON.parse(content) as LocalRepositoryStore;

    return {
      repositories: parsed.repositories ?? {},
      snapshots: parsed.snapshots ?? {}
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        repositories: {},
        snapshots: {}
      };
    }

    throw error;
  }
}

async function writeLocalStore(store: LocalRepositoryStore) {
  const repositoryStoreFile = getRepositoryStoreFile();
  await fs.mkdir(path.dirname(repositoryStoreFile), { recursive: true });
  await fs.writeFile(repositoryStoreFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getRepositoryStoreFile() {
  return process.env.REPOSITORY_STORE_FILE
    ? path.resolve(process.env.REPOSITORY_STORE_FILE)
    : path.join(dataDir, "repository-store.json");
}

function upsertLocalSnapshot(snapshots: MetricSnapshot[], repo: RepoSnapshot, snapshotDate: string) {
  const nextSnapshot: MetricSnapshot = {
    snapshotDate,
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssues,
    pushedAt: repo.pushedAt,
    capturedAt: new Date().toISOString()
  };
  const withoutSameDate = snapshots.filter((snapshot) => snapshot.snapshotDate !== snapshotDate);

  return [...withoutSameDate, nextSnapshot].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}

function applyTrendDeltas(repo: RepoSnapshot, snapshots: MetricSnapshot[], snapshotDate: string): RepoSnapshot {
  const previousSnapshots = snapshots.filter((snapshot) => snapshot.snapshotDate < snapshotDate);
  const previousSnapshot = previousSnapshots.at(-1);
  const targetWeekDate = shiftDate(snapshotDate, -7);
  const weeklyBaseline =
    previousSnapshots.filter((snapshot) => snapshot.snapshotDate <= targetWeekDate).at(-1) ?? previousSnapshots[0];

  return {
    ...repo,
    dailyStarDelta: previousSnapshot ? Math.max(0, repo.stars - previousSnapshot.stars) : repo.dailyStarDelta,
    weeklyStarDelta: weeklyBaseline ? Math.max(0, repo.stars - weeklyBaseline.stars) : repo.weeklyStarDelta
  };
}

function mapSnapshotRow(row: Record<string, unknown>): MetricSnapshot {
  return {
    snapshotDate: String(row.snapshot_date),
    stars: Number(row.stars),
    forks: Number(row.forks),
    openIssues: Number(row.open_issues),
    pushedAt: row.pushed_at instanceof Date ? row.pushed_at.toISOString() : String(row.pushed_at ?? ""),
    capturedAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "")
  };
}

function mapRepositoryRow(row: Record<string, unknown>): RepoSnapshot {
  const detectedFiles = toStringArray(row.detected_files);
  const topics = toStringArray(row.topics);
  const languages = Array.isArray(row.languages)
    ? row.languages
        .filter(
          (item): item is { name: string; bytes: number } =>
            Boolean(item) &&
            typeof item === "object" &&
            "name" in item &&
            typeof item.name === "string" &&
            "bytes" in item &&
            Number.isFinite(Number(item.bytes))
        )
        .map((item) => ({ name: item.name, bytes: Number(item.bytes) }))
    : [];

  const repo: RepoSnapshot = {
    id: Number(row.github_id),
    fullName: String(row.full_name),
    owner: String(row.owner_login),
    name: String(row.name),
    description: String(row.description ?? ""),
    url: String(row.html_url),
    homepage: row.homepage ? String(row.homepage) : undefined,
    topics,
    category: normalizeCategory(row.category),
    primaryLanguage: String(row.primary_language ?? "Unknown"),
    languages,
    stars: Number(row.latest_stars ?? 0),
    forks: Number(row.latest_forks ?? 0),
    openIssues: Number(row.latest_open_issues ?? 0),
    license: row.license_spdx ? String(row.license_spdx) : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    pushedAt: toIsoString(row.snapshot_pushed_at ?? row.pushed_at),
    readmeExcerpt: sanitizeReadmeExcerpt(String(row.readme_excerpt ?? "")),
    detectedFiles,
    hasTests: Boolean(row.has_tests),
    hasExamples: Boolean(row.has_examples),
    hasCi: Boolean(row.has_ci),
    hasDocker: Boolean(row.has_docker),
    dependencies: toStringArray(row.dependencies),
    dailyStarDelta: 0,
    weeklyStarDelta: 0,
    sizeKb: Number(row.size_kb ?? 0)
  };
  repo.enrichment = normalizeEnrichmentSignals(row.enrichment_signals, repo);
  return repo;
}

function normalizeCategory(value: unknown): RepoSnapshot["category"] {
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

  return "fullstack";
}

function normalizeRepository(repo: RepoSnapshot): RepoSnapshot {
  return {
    ...repo,
    readmeExcerpt: sanitizeReadmeExcerpt(repo.readmeExcerpt),
    enrichment: normalizeEnrichmentSignals(repo.enrichment, repo)
  };
}

function normalizeCandidateSearchOptions(options: CandidateSearchOptions) {
  const query = (options.query ?? "").trim().slice(0, 120);
  const category = normalizeCandidateCategory(options.category);
  const sort: CandidateSort = options.sort === "recent" || options.sort === "name" ? options.sort : "stars";
  const page = Math.max(1, Math.round(Number(options.page) || 1));
  const pageSize = Math.max(1, Math.min(48, Math.round(Number(options.pageSize) || 12)));

  return { query, category, sort, page, pageSize };
}

function normalizeCandidateCategory(value: CandidateSearchOptions["category"]): "all" | RadarCategory {
  if (value === "all" || value === undefined) return "all";
  const normalized = normalizeCategory(value);
  return normalized === value ? normalized : "all";
}

function compareCandidates(a: RepoSnapshot, b: RepoSnapshot, sort: CandidateSort) {
  if (sort === "recent") {
    const difference = new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime();
    if (difference !== 0) return difference;
  } else if (sort === "name") {
    return a.fullName.localeCompare(b.fullName);
  } else if (b.stars !== a.stars) {
    return b.stars - a.stars;
  }

  return a.fullName.localeCompare(b.fullName);
}

function clampCandidatePage(page: number, total: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}

function createCandidateSearchResult(
  items: RepoSnapshot[],
  total: number,
  sourceTotal: number,
  page: number,
  pageSize: number
): CandidateSearchResult {
  return {
    items,
    total,
    sourceTotal,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function shiftDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
