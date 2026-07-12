import { discoverGithubCandidates } from "../lib/github/discovery";
import { getRepoSignal } from "../lib/repository-signals";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const result = await discoverGithubCandidates();

  console.log("GitHub discovery dry run");
  console.log(`Source: ${result.source}`);
  console.log(result.message);

  for (const repo of result.repositories.slice(0, 10)) {
    console.log(
      [
        repo.fullName,
        repo.primaryLanguage,
        `${repo.stars} stars`,
        `readme:${getRepoSignal(repo, "readme")}`,
        `examples:${getRepoSignal(repo, "examples")}`,
        `tests:${getRepoSignal(repo, "tests")}`,
        `ci:${getRepoSignal(repo, "ci")}`
      ].join(" | ")
    );
  }
}
