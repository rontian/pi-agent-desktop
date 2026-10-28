#!/usr/bin/env node
// Build and sign a complete macOS release locally. Never writes signing keys into Git.
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { rootDir, forkReleaseTag } from "./release-components.mjs";
import { validateUpdaterPublicKey } from "./configure-updater-public-key.mjs";
import { localReleaseBuildEnvironment } from "./local-release-signing-env.mjs";
import { resolveSigningPassword, promptSigningPassword, verifySigningPasswordWithTauri } from "./local-signing-password.mjs";
import {
  macReleaseAssets, uploadAssetPaths, createMacUpdaterManifest, describeFile, RELEASE_LATEST_PATH, RELEASE_METADATA_PATH, RELEASE_UPLOAD_DIR,
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
const signingPassword = await resolveSigningPassword({
  initialPassword: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
  verifyPassword: (password) => verifySigningPasswordWithTauri({ rootDir, keyFile, password }),
  promptPassword: promptSigningPassword,
  onWrongPassword: () => console.error("Updater signing password is incorrect; please enter it again."),
});
const env = localReleaseBuildEnvironment(process.env, {
  keyFile, signingPassword, publicKey,
});
// This local release intentionally skips Apple notarization even when the
// maintainer has Apple credentials exported for other projects.
console.log("macOS release: Developer ID signing if configured; Apple notarization intentionally disabled.");
const assets = macReleaseAssets(version);
const upload = uploadAssetPaths(version);
run("npm", ["run", "release:check"]);
run("npm", ["run", "desktop:prepare"]);
// Prevent a failed build from mistakenly reusing stale artifacts from an earlier run.
for (const path of [assets.dmg, assets.archive, assets.signature, upload.dmg, upload.archive, upload.signature, RELEASE_LATEST_PATH, RELEASE_METADATA_PATH]) {
  await rm(path, { force: true });
}
const tauriConfig = JSON.stringify({ plugins: { updater: { pubkey: publicKey } } });
run("npx", ["tauri", "build", "--bundles", "app,dmg", "--config", tauriConfig], env);
await mkdir(RELEASE_UPLOAD_DIR, { recursive: true });
for (const kind of ["dmg", "archive", "signature"]) await copyFile(assets[kind], upload[kind]);
const signature = (await readFile(upload.signature, "utf8")).trim();
const latest = createMacUpdaterManifest(version, signature);
await mkdir(join(rootDir, "src-tauri", "target", "release", "bundle", "local-release"), { recursive: true });
await writeFile(RELEASE_LATEST_PATH, JSON.stringify(latest, null, 2) + "\n");
const files = {};
for (const [name, path] of Object.entries({
  ...upload, componentManifest: assets.componentManifest, latest: RELEASE_LATEST_PATH,
})) {
  files[name] = await describeFile(path);
}
await writeFile(RELEASE_METADATA_PATH, JSON.stringify({
  version, tag: forkReleaseTag(version), commit, repository: "rontian/pi-agent-desktop", files,
}, null, 2) + "\n");
console.log("Signed macOS release is ready locally at " + RELEASE_METADATA_PATH);
console.log("Next: npm run release:publish:mac (uploads assets using gh, after review).");
