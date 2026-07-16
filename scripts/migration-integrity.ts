import { createHash } from "node:crypto";

export const migrationAdvisoryLockName = "github-learning-radar:schema-migrations";

export type ReservedTransactionSql = (strings: TemplateStringsArray) => PromiseLike<unknown>;

export function calculateMigrationChecksum(contents: string | Buffer) {
  return createHash("sha256").update(contents).digest("hex");
}

export function assertMigrationChecksum(version: string, storedChecksum: string, currentChecksum: string) {
  if (storedChecksum !== currentChecksum) {
    throw new Error(`Migration checksum mismatch for ${version}; applied migrations must not be edited.`);
  }
}

export async function runInReservedTransaction(sql: ReservedTransactionSql, operation: () => Promise<void>) {
  await sql`BEGIN`;
  try {
    await operation();
    await sql`COMMIT`;
  } catch (error) {
    try {
      await sql`ROLLBACK`;
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Migration transaction and rollback both failed.");
    }
    throw error;
  }
}
