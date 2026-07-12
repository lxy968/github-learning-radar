import { getRecommendations, getRadarStats } from "../lib/radar";

const stats = getRadarStats();
const recommendations = getRecommendations();

console.log("GitHub Learning Radar dry run");
console.log(`Projects: ${stats.projectCount}`);
console.log(`Weekly stars: ${stats.totalWeeklyStars}`);
console.log(`Average score: ${stats.avgScore}`);
console.log("");

for (const item of recommendations) {
  console.log(`#${item.rank} ${item.repo.fullName} - ${item.score.finalScore}`);
  console.log(`  ${item.analysis.oneLineSummary}`);
}
