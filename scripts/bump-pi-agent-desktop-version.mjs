import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchRecentReleases,
  componentRepositories,
  nextDesktopVersion,
  nextManualDesktopVersion,
  normalizeVersion,
  rootDir,
} from "./release-components.mjs";

const packagePath = join(rootDir, "src-tauri", "pi-agent-desktop-package.json");
const cargoPath = join(rootDir, "src-tauri", "Cargo.toml");
const lockPath = join(rootDir, "src-tauri", "Cargo.lock");
const desktopPackage = JSON.parse(await readFile(packagePath, "utf8"));
const current = normalizeVersion(desktopPackage.version);
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--next-patch") || args.length > 1) {
  throw new Error("Usage: node scripts/bump-pi-agent-desktop-version.mjs [--next-patch]");
}
const released = await fetchRecentReleases(componentRepositories["pi-agent-desktop"], { allowMissing: true });
const releasedVersions = released.map((release) => release.version);
const next = args.includes("--next-patch")
  ? nextManualDesktopVersion(current, releasedVersions)
  : nextDesktopVersion(current, releasedVersions);

desktopPackage.version = next;
await writeFile(packagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`);

const cargo = await readFile(cargoPath, "utf8");
await writeFile(cargoPath, cargo.replace(/^(version\s*=\s*")[^"]+("\s*)$/m, `$1${next}$2`));

const lock = await readFile(lockPath, "utf8");
await writeFile(
  lockPath,
  lock.replace(/(name = "pi-agent-desktop"\nversion = ")[^"]+("\n)/, `$1${next}$2`),
);
console.log(`pi-agent-desktop ${current} -> ${next}`);
