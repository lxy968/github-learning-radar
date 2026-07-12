import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");

await copyPath(path.join(root, "public"), path.join(standaloneRoot, "public"));
await copyPath(path.join(root, ".next", "static"), path.join(standaloneRoot, ".next", "static"));
await copyPath(
  path.join(root, "scripts", "production-check.mjs"),
  path.join(standaloneRoot, "scripts", "production-check.mjs")
);

async function copyPath(source, destination) {
  try {
    await fs.access(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
}
