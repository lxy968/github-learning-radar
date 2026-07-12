import { promises as fs } from "fs";
import path from "path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("DATABASE_URL is not set. Skipping Postgres migration.");
  process.exit(0);
}

const migrationsDir = path.join(process.cwd(), "migrations");
const sql = postgres(databaseUrl, { max: 1 });

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const applied = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations WHERE version = ${file}
    `;

    if (applied.length > 0) {
      console.log(`Skipping ${file}; already applied.`);
      continue;
    }

    const migration = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO schema_migrations (version) VALUES (${file})`;
    });

    console.log(`Applied ${file}.`);
  }
}
