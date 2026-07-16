import { seedAnalyses, seedRepos, defaultPreference } from "@/lib/seed-data";
import { scoreRepository } from "@/lib/scoring";
import { getLatestRadarRun } from "@/lib/radar-runs";
import { createRuleBasedAnalysis, upgradeLegacyRecommendationContent } from "@/lib/ai/analyze";
import { getRepositoryCandidate } from "@/lib/repository-store";
import { showcaseFeaturedRepoId } from "@/lib/showcase-content";
import type { RadarCategory, RadarRecommendation, UserPreference } from "@/lib/types";

export function getRecommendations(preference: UserPreference = defaultPreference): RadarRecommendation[] {
  return seedRepos
    .map((repo) => {
      const analysis = seedAnalyses.find((item) => item.repoId === repo.id);

      if (!analysis) {
        throw new Error(`Missing analysis for ${repo.fullName}`);
      }

      return {
        repo,
        score: scoreRepository(repo, preference),
        analysis,
        rank: 0
      };
    })
    .sort((a, b) => {
      if (a.repo.id === showcaseFeaturedRepoId) return -1;
      if (b.repo.id === showcaseFeaturedRepoId) return 1;
      return b.score.finalScore - a.score.finalScore;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function getRecommendation(owner: string, repoName: string) {
  const fullName = `${owner}/${repoName}`.toLowerCase();

  return getRecommendations().find((item) => item.repo.fullName.toLowerCase() === fullName);
}

export async function getCurrentRecommendations(preference?: UserPreference) {
  const latestRun = await getLatestRadarRun();
  const recommendations = latestRun?.recommendations ?? getRecommendations(preference ?? defaultPreference);
  const activePreference = preference ?? latestRun?.preference ?? defaultPreference;
  const ranked =
    preference && latestRun
      ? recommendations
          .map((item) => ({ ...item, score: scoreRepository(item.repo, preference) }))
          .sort((a, b) => b.score.finalScore - a.score.finalScore)
          .map((item, index) => ({ ...item, rank: index + 1 }))
      : recommendations;

  return ranked.map((item) => upgradeLegacyRecommendationContent(item, activePreference));
}

export async function getCurrentRecommendation(owner: string, repoName: string) {
  const fullName = `${owner}/${repoName}`.toLowerCase();
  const recommendations = await getCurrentRecommendations();

  return recommendations.find((item) => item.repo.fullName.toLowerCase() === fullName);
}

export async function getLearningRecommendation(
  owner: string,
  repoName: string,
  preference: UserPreference | Pick<UserPreference, "level" | "goal"> = defaultPreference
): Promise<RadarRecommendation | null> {
  const current = await getCurrentRecommendation(owner, repoName);
  if (current) return current;

  const fullName = `${owner}/${repoName}`.toLowerCase();
  const repo =
    (await getRepositoryCandidate(owner, repoName)) ??
    seedRepos.find((item) => item.fullName.toLowerCase() === fullName) ??
    null;
  if (!repo) return null;

  const activePreference: UserPreference = { ...defaultPreference, ...preference };
  const score = scoreRepository(repo, activePreference);
  return {
    repo,
    score,
    analysis: createRuleBasedAnalysis(repo, score, activePreference),
    rank: 0,
    analysisTrace: {
      source: "rule",
      providerAttempts: []
    }
  };
}

export function getRadarStats(recommendations = getRecommendations()) {
  const totalWeeklyStars = recommendations.reduce((sum, item) => sum + item.repo.weeklyStarDelta, 0);
  const avgScore =
    recommendations.length > 0
      ? Math.round(recommendations.reduce((sum, item) => sum + item.score.finalScore, 0) / recommendations.length)
      : 0;

  return {
    projectCount: recommendations.length,
    totalWeeklyStars,
    avgScore,
    topCategory: getTopCategory(recommendations)
  };
}

export async function getCurrentRadarStats(preference?: UserPreference) {
  return getRadarStats(await getCurrentRecommendations(preference));
}

export function getTopCategory(recommendations: RadarRecommendation[]): RadarCategory | "none" {
  if (recommendations.length === 0) return "none";

  const counts = new Map<RadarCategory, number>();

  for (const item of recommendations) {
    counts.set(item.repo.category, (counts.get(item.repo.category) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
}
