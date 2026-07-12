import { runDataRetention } from "../lib/data-retention";
import { loadLocalEnv } from "./load-local-env";

loadLocalEnv(".env.local");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmed = process.argv.includes("--confirm=delete-expired-data");
  if (apply && !confirmed) {
    throw new Error("Apply mode requires --confirm=delete-expired-data. Run without --apply to preview first.");
  }

  const report = await runDataRetention({ apply });
  console.log(JSON.stringify(report, null, 2));
  if (!apply) {
    console.log("Dry run only. Re-run with --apply --confirm=delete-expired-data to execute this plan.");
  }
}
