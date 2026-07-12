import { analyzeRepositoryWithFallback } from "../lib/ai/analyze";
import { getConfiguredAiModel } from "../lib/ai/provider";
import { scoreRepository } from "../lib/scoring";
import { defaultPreference, seedRepos } from "../lib/seed-data";
import { loadLocalEnv } from "./load-local-env";

loadLocalEnv(".env.local");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const configuredModel = getConfiguredAiModel();

  if (!configuredModel) {
    console.log("AI smoke skipped: no DEEPSEEK_API_KEY configured.");
    return;
  }

  const repo = seedRepos[0];
  const score = scoreRepository(repo, defaultPreference);
  const result = await analyzeRepositoryWithFallback(repo, score, defaultPreference);

  console.log(`provider=${configuredModel.provider}`);
  console.log(`model=${configuredModel.modelId}`);
  console.log(`source=${result.source}`);

  if (result.source !== "ai") {
    console.log(`fallbackReason=${result.fallbackReason ?? "unknown"}`);
    if (result.errorSummary) console.log(`error=${result.errorSummary}`);
    process.exit(1);
  }

  console.log(`summary=${result.analysis.oneLineSummary.replace(/\s+/g, " ").slice(0, 160)}`);
}
