import { createHash } from "node:crypto";

export const migrationAdvisoryLockName = "github-learning-radar:schema-migrations";

export function calculateMigrationChecksum(contents: string | Buffer) {
  return createHash("sha256").update(contents).digest("hex");
}

export function assertMigrationChecksum(version: string, storedChecksum: string, currentChecksum: string) {
  if (storedChecksum !== currentChecksum) {
    throw new Error(`Migration checksum mismatch for ${version}; applied migrations must not be edited.`);
  }
}
