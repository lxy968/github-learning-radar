import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPotentialSecrets } from "./repository-hygiene";

const root = process.cwd();
const maximumScannedBlobBytes = 1_000_000;
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sql", ".yml", ".yaml", ".toml"]);

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}

function main() {
  const objectListing = runGit(["rev-list", "--objects", "--all"]);
  const entries = objectListing
    .split(/\r?\n/)
    .map(parseObjectEntry)
    .filter((entry): entry is { objectId: string; filePath: string } => Boolean(entry?.filePath));
  const objectIds = Array.from(new Set(entries.map((entry) => entry.objectId)));
  const metadata = readObjectMetadata(objectIds);
  const findings = new Set<string>();
  let scannedBlobCount = 0;

  for (const entry of entries) {
    const object = metadata.get(entry.objectId);
    if (!object || object.type !== "blob") continue;

    if (isForbiddenHistoricalPath(entry.filePath)) {
      findings.add(`forbidden historical file | ${entry.filePath} | blob ${entry.objectId.slice(0, 12)}`);
    }

    if (object.size > maximumScannedBlobBytes || !isScannableTextPath(entry.filePath)) continue;
    const content = runGit(["cat-file", "-p", entry.objectId], maximumScannedBlobBytes + 1024);
    scannedBlobCount += 1;
    for (const finding of findPotentialSecrets(content)) {
      findings.add(`${finding.label} | ${entry.filePath} | blob ${entry.objectId.slice(0, 12)}`);
    }
  }

  if (findings.size > 0) {
    for (const finding of Array.from(findings).sort()) console.error(`ERROR: ${finding}`);
    console.error(`Git history secret scan failed with ${findings.size} finding(s).`);
    process.exit(1);
  }

  console.log(`Git history secret scan passed (${scannedBlobCount} text blob path(s) checked).`);
}

function readObjectMetadata(objectIds: string[]) {
  const metadata = new Map<string, { type: string; size: number }>();
  if (objectIds.length === 0) return metadata;
  const output = runGit(
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    32 * 1024 * 1024,
    `${objectIds.join("\n")}\n`
  );
  for (const line of output.split(/\r?\n/)) {
    const [objectId, type, sizeValue] = line.trim().split(/\s+/);
    if (!objectId || !type) continue;
    const size = Number(sizeValue);
    metadata.set(objectId, { type, size: Number.isFinite(size) ? size : 0 });
  }
  return metadata;
}

function parseObjectEntry(line: string) {
  const separator = line.indexOf(" ");
  if (separator < 1) return null;
  return {
    objectId: line.slice(0, separator),
    filePath: normalizePath(line.slice(separator + 1))
  };
}

function runGit(args: string[], maxBuffer = 32 * 1024 * 1024, input?: string) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    maxBuffer,
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed while scanning history.`);
  }
  return result.stdout;
}

function isScannableTextPath(filePath: string) {
  return path.posix.basename(filePath) === "Dockerfile" || textExtensions.has(path.posix.extname(filePath).toLowerCase());
}

export function isForbiddenHistoricalPath(filePath: string) {
  const normalized = normalizePath(filePath);
  if (normalized === ".env.example" || normalized.endsWith("/.env.example")) return false;
  return (
    /(^|\/)\.env(?:$|\.)/i.test(normalized) ||
    /(^|\/)\.data\//i.test(normalized) ||
    /(^|\/)(?:\.next|node_modules|dist|coverage)\//i.test(normalized) ||
    /\.(?:db|sqlite|sqlite3|pem|key|p12|pfx)$/i.test(normalized)
  );
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}
