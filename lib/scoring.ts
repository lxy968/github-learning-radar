import { clamp } from "@/lib/utils";
import type { RepoSnapshot, RuleScore, UserPreference } from "@/lib/types";
import { getRepoSignal, hasPresentSignal } from "@/lib/repository-signals";

export function scoreRepository(repo: RepoSnapshot, preference: UserPreference): RuleScore {
  const trendScore = clamp(repo.weeklyStarDelta / 18 + repo.dailyStarDelta / 4);
  const readmeState = getRepoSignal(repo, "readme");
  const docsSignal =
    signalPoints(readmeState, repo.readmeExcerpt.length > 140 ? 22 : 10, 10) +
    signalPoints(getRepoSignal(repo, "examples"), 16, 8);
  const learningValueScore = clamp(
    docsSignal + repo.topics.length * 5 + signalPoints(getRepoSignal(repo, "tests"), 12, 6)
  );
  const sizeFit = repo.sizeKb < 12000 ? 28 : repo.sizeKb < 35000 ? 36 : repo.sizeKb < 60000 ? 24 : 10;
  const cloneabilityScore = clamp(
    sizeFit +
      signalPoints(getRepoSignal(repo, "examples"), 18, 9) +
      signalPoints(getRepoSignal(repo, "docker"), 8, 4) +
      (repo.license ? 12 : 0)
  );
  const repoHealthScore = clamp(
    signalPoints(getRepoSignal(repo, "ci"), 22, 11) +
      signalPoints(getRepoSignal(repo, "tests"), 24, 12) +
      (repo.openIssues < 100 ? 16 : 8) +
      recencyScore(repo.pushedAt)
  );
  const topicMatch = repo.topics.filter((topic) =>
    preference.interests.some((interest) => topic.includes(interest.split("-")[0]))
  ).length;
  const languageMatch = preference.languages.includes(repo.primaryLanguage) ? 34 : 0;
  const categoryMatch = preference.interests.includes(repo.category) ? 38 : 0;
  const userMatchScore = clamp(categoryMatch + languageMatch + topicMatch * 8);
  const finalScore = Math.round(
    trendScore * 0.3 +
      learningValueScore * 0.25 +
      cloneabilityScore * 0.2 +
      repoHealthScore * 0.15 +
      userMatchScore * 0.1
  );

  return {
    repoId: repo.id,
    trendScore: Math.round(trendScore),
    learningValueScore: Math.round(learningValueScore),
    cloneabilityScore: Math.round(cloneabilityScore),
    repoHealthScore: Math.round(repoHealthScore),
    userMatchScore: Math.round(userMatchScore),
    finalScore,
    reasons: buildReasons(repo, finalScore, userMatchScore),
    risks: buildRisks(repo)
  };
}

function recencyScore(pushedAt: string) {
  const days = (Date.now() - new Date(pushedAt).getTime()) / 86_400_000;
  if (days <= 3) return 28;
  if (days <= 14) return 22;
  if (days <= 60) return 16;
  return 8;
}

function buildReasons(repo: RepoSnapshot, finalScore: number, userMatchScore: number) {
  const reasons = [`学习雷达分 ${finalScore}`];

  if (repo.weeklyStarDelta > 500) reasons.push(`近 7 天新增 ${repo.weeklyStarDelta} stars`);
  if (hasPresentSignal(repo, "examples")) reasons.push("有 examples，适合裁剪复刻");
  if (hasPresentSignal(repo, "tests") || hasPresentSignal(repo, "ci")) reasons.push("工程结构可读性较好");
  if ((["tests", "examples", "ci"] as const).some((signal) => getRepoSignal(repo, signal) === "unknown")) {
    reasons.push("部分工程信号尚未抓取，评分未按缺失处理");
  }
  if (userMatchScore > 50) reasons.push("命中你的兴趣标签和语言偏好");

  return reasons;
}

function buildRisks(repo: RepoSnapshot) {
  const risks: string[] = [];

  if (repo.sizeKb > 45000) risks.push("仓库体量偏大，mini 复刻需要严格裁剪");
  if (getRepoSignal(repo, "tests") === "absent") risks.push("已检查根目录但未发现测试信号，源码学习时要自行验证");
  if (!repo.license) risks.push("许可证信息不清晰");
  if (repo.openIssues > 120) risks.push("issue 较多，可能维护压力较大");

  return risks;
}

function signalPoints(state: ReturnType<typeof getRepoSignal>, present: number, unknown: number) {
  if (state === "present") return present;
  if (state === "unknown") return unknown;
  return 0;
}
