#!/usr/bin/env node
// Build and sign a complete macOS release locally. Never writes signing keys into Git.
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { rootDir } from "./release-components.mjs";
import { validateUpdaterPublicKey } from "./configure-updater-public-key.mjs";
import {
  macReleaseAssets, createMacUpdaterManifest, describeFile, RELEASE_LATEST_PATH, RELEASE_METADATA_PATH,
} from "./local-release.mjs";

function run(program, args, env = process.env) {
  const output = spawnSync(program, args, { cwd: rootDir, env, stdio: "inherit" });
  if (output.error) throw output.error;
  if (output.status !== 0) throw new Error(program + " " + args.join(" ") + " failed (exit " + output.status + ")");
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("release:build:mac must run on an Apple Silicon Mac");
}
const branch = execFileSync("git", ["branch", "--show-current"], { cwd: rootDir, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: rootDir, encoding: "utf8" }).trim();
if (branch !== "main" || dirty) throw new Error("Release build requires a clean local main checkout (got " + branch + ").");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim();
const version = JSON.parse(await readFile(join(rootDir, "src-tauri", "pi-agent-desktop-package.json"), "utf8")).version;
const keyFile = resolve(process.env.PI_AGENT_RELEASE_KEY_PATH || join(homedir(), ".tauri", "rontian-pi-agent.key"));
const publicKey = validateUpdaterPublicKey(await readFile(keyFile + ".pub", "utf8"));
await readFile(keyFile); // Fail before expensive build if the private key is missing.
if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  throw new Error("Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD in this terminal (read -rs on zsh). Do not store it in Git.");
}
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: keyFile,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
  PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY: publicKey,
  APPLE_SIGNING_IDENTITY: process.env.APPLE_SIGNING_IDENTITY || "-",
};
const assets = macReleaseAssets(version);
run("npm", ["run", "release:verify"]);
run("npm", ["run", "desktop:prepare"]);
// Prevent a failed build from mistakenly reusing stale artifacts from an earlier run.
for (const path of [assets.dmg, assets.archive, assets.signature, RELEASE_LATEST_PATH, RELEASE_METADATA_PATH]) {
  await rm(path, { force: true });
}
const tauriConfig = JSON.stringify({ plugins: { updater: { pubkey: publicKey } } });
run("npx", ["tauri", "build", "--bundles", "app,dmg", "--config", tauriConfig], env);
const signature = (await readFile(assets.signature, "utf8")).trim();
const latest = createMacUpdaterManifest(version, signature);
await mkdir(join(rootDir, "src-tauri", "target", "release", "bundle", "local-release"), { recursive: true });
await writeFile(RELEASE_LATEST_PATH, JSON.stringify(latest, null, 2) + "\n");
const files = {};
for (const [name, path] of Object.entries({
  ...assets, latest: RELEASE_LATEST_PATH,
})) {
  files[name] = await describeFile(path);
}
await writeFile(RELEASE_METADATA_PATH, JSON.stringify({
  version, commit, repository: "rontian/pi-agent-desktop", files,
}, null, 2) + "\n");
console.log("Signed macOS release is ready locally at " + RELEASE_METADATA_PATH);
console.log("Next: npm run release:publish:mac (uploads assets using gh, after review).");
