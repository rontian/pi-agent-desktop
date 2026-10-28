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

if (next !== current) {
  desktopPackage.version = next;
  await writeFile(packagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`);

  const cargo = await readFile(cargoPath, "utf8");
  const updatedCargo = cargo.replace(/^(version\s*=\s*")[^"]+("\s*)$/m, (_match, before, after) => `${before}${next}${after}`);
  if (cargo === updatedCargo) throw new Error("Cargo.toml desktop version was not found");
  await writeFile(cargoPath, updatedCargo);

  const lock = await readFile(lockPath, "utf8");
  const updatedLock = lock.replace(/(name = "pi-agent-desktop"\nversion = ")[^"]+("\n)/, (_match, before, after) => `${before}${next}${after}`);
  if (lock === updatedLock) throw new Error("Cargo.lock desktop version was not found");
  await writeFile(lockPath, updatedLock);
}
console.log(next === current
  ? `pi-agent-desktop ${current}: not yet released; keeping version`
  : `pi-agent-desktop ${current} -> ${next}`);
