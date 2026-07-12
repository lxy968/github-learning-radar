import { persistRepositorySnapshots } from "../lib/repository-store";
import { seedRepos } from "../lib/seed-data";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const firstDayRepos = seedRepos.slice(0, 2).map((repo) => ({
    ...repo,
    stars: repo.stars - 12,
    dailyStarDelta: 0,
    weeklyStarDelta: 0
  }));
  const secondDayRepos = seedRepos.slice(0, 2).map((repo) => ({
    ...repo,
    dailyStarDelta: 0,
    weeklyStarDelta: 0
  }));

  await persistRepositorySnapshots(firstDayRepos, "2026-07-07");
  const enriched = await persistRepositorySnapshots(secondDayRepos, "2026-07-08");

  console.log("Repository store dry run");

  for (const repo of enriched) {
    console.log(`${repo.fullName} | daily +${repo.dailyStarDelta} | weekly +${repo.weeklyStarDelta}`);
  }
}
