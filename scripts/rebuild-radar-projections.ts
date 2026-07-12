import { rebuildRadarRunProjections } from "../lib/radar-runs";
import { loadLocalEnv } from "./load-local-env";

loadLocalEnv(".env.local");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const result = await rebuildRadarRunProjections();
  if (result.status === "skipped") {
    console.log("Radar projection rebuild skipped: DATABASE_URL is not configured.");
    return;
  }

  console.log(
    `Rebuilt normalized projections for ${result.rebuiltRunCount} radar runs and ${result.projectedRecommendationCount} recommendations.`
  );
}
