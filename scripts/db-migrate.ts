import { promises as fs } from "fs";
import path from "path";
import postgres from "postgres";
import {
  assertMigrationChecksum,
  calculateMigrationChecksum,
  migrationAdvisoryLockName,
  runInReservedTransaction
} from "./migration-integrity";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("DATABASE_URL is not set. Skipping Postgres migration.");
  process.exit(0);
}

const migrationsDir = path.join(process.cwd(), "migrations");
const pool = postgres(databaseUrl, { max: 2 });

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

async function main() {
  const sql = await pool.reserve();
  let lockAcquired = false;

  try {
    await sql`SELECT pg_advisory_lock(hashtext(${migrationAdvisoryLockName}))`;
    lockAcquired = true;
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`;

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const migration = await fs.readFile(path.join(migrationsDir, file), "utf8");
      const checksum = calculateMigrationChecksum(migration);
      const applied = await sql<{ version: string; checksum: string | null }[]>`
        SELECT version, checksum FROM schema_migrations WHERE version = ${file}
      `;

      if (applied.length > 0) {
        if (applied[0].checksum) {
          assertMigrationChecksum(file, applied[0].checksum, checksum);
        } else {
          await sql`UPDATE schema_migrations SET checksum = ${checksum} WHERE version = ${file} AND checksum IS NULL`;
          console.log(`Recorded checksum for previously applied migration ${file}.`);
        }
        console.log(`Skipping ${file}; already applied and verified.`);
        continue;
      }

      await runInReservedTransaction(sql, async () => {
        await sql.unsafe(migration);
        await sql`
          INSERT INTO schema_migrations (version, checksum) VALUES (${file}, ${checksum})
        `;
      });

      console.log(`Applied ${file}.`);
    }
  } finally {
    try {
      if (lockAcquired) await sql`SELECT pg_advisory_unlock(hashtext(${migrationAdvisoryLockName}))`;
    } finally {
      sql.release();
    }
  }
}
