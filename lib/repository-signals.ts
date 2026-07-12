import type { RepoEnrichmentSignals, RepoSignalState, RepoSnapshot } from "@/lib/types";

export type RepoSignalKey = keyof RepoEnrichmentSignals;

export function getRepoSignal(repo: RepoSnapshot, signal: RepoSignalKey): RepoSignalState {
  const explicit = repo.enrichment?.[signal];
  if (explicit === "present" || explicit === "absent" || explicit === "unknown") return explicit;

  if (signal === "readme") return repo.readmeExcerpt.trim() ? "present" : "unknown";
  if (signal === "languages") return repo.languages.length > 0 ? "present" : "unknown";
  if (signal === "rootFiles") return repo.detectedFiles.length > 0 ? "present" : "unknown";
  if (signal === "tests") return repo.hasTests ? "present" : "unknown";
  if (signal === "examples") return repo.hasExamples ? "present" : "unknown";
  if (signal === "ci") return repo.hasCi ? "present" : "unknown";
  return repo.hasDocker ? "present" : "unknown";
}

export function hasPresentSignal(repo: RepoSnapshot, signal: RepoSignalKey) {
  return getRepoSignal(repo, signal) === "present";
}

export function createUnknownEnrichmentSignals(): RepoEnrichmentSignals {
  return {
    readme: "unknown",
    languages: "unknown",
    rootFiles: "unknown",
    tests: "unknown",
    examples: "unknown",
    ci: "unknown",
    docker: "unknown"
  };
}

export function normalizeEnrichmentSignals(value: unknown, repo: RepoSnapshot): RepoEnrichmentSignals {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    readme: normalizeState(input.readme, repo.readmeExcerpt ? "present" : "unknown"),
    languages: normalizeState(input.languages, repo.languages.length > 0 ? "present" : "unknown"),
    rootFiles: normalizeState(input.rootFiles, repo.detectedFiles.length > 0 ? "present" : "unknown"),
    tests: normalizeState(input.tests, repo.hasTests ? "present" : "unknown"),
    examples: normalizeState(input.examples, repo.hasExamples ? "present" : "unknown"),
    ci: normalizeState(input.ci, repo.hasCi ? "present" : "unknown"),
    docker: normalizeState(input.docker, repo.hasDocker ? "present" : "unknown")
  };
}

function normalizeState(value: unknown, fallback: RepoSignalState): RepoSignalState {
  return value === "present" || value === "absent" || value === "unknown" ? value : fallback;
}
