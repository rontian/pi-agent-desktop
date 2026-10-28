#!/usr/bin/env node
// Build and sign a complete macOS release locally. Never writes signing keys into Git.
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { rootDir, forkReleaseTag } from "./release-components.mjs";
import { validateUpdaterPublicKey } from "./configure-updater-public-key.mjs";
import { assertDeveloperIdReleaseEnvironment, signStagedMacResources } from "./sign-staged-macos.mjs";
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
const identity = assertDeveloperIdReleaseEnvironment(process.env);
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
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: keyFile,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: signingPassword,
  PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY: publicKey,
  APPLE_SIGNING_IDENTITY: identity,
};
const assets = macReleaseAssets(version);
const upload = uploadAssetPaths(version);
run("npm", ["run", "release:check"]);
run("npm", ["run", "desktop:prepare"]);
// macOS notarization scans executable code inside Tauri resources; sign native
// Node addons, dylibs and the embedded Node helper before the outer app bundle.
await signStagedMacResources({ identity });
// Prevent a failed build from mistakenly reusing stale artifacts from an earlier run.
for (const path of [assets.dmg, assets.archive, assets.signature, upload.dmg, upload.archive, upload.signature, RELEASE_LATEST_PATH, RELEASE_METADATA_PATH]) {
  await rm(path, { force: true });
}
const tauriConfig = JSON.stringify({ plugins: { updater: { pubkey: publicKey } } });
run("npx", ["tauri", "build", "--bundles", "app,dmg", "--config", tauriConfig], env);
// Tauri must have notarized and stapled the app before any release metadata
// can be marked publishable. A successful bundle command alone is insufficient.
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", assets.app]);
run("xcrun", ["stapler", "validate", assets.app]);
run("spctl", ["--assess", "--type", "execute", "--verbose=4", assets.app]);
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
  version, tag: forkReleaseTag(version), commit, repository: "rontian/pi-agent-desktop",
  appleNotarized: true, files,
}, null, 2) + "\n");
console.log("Developer ID signed and notarized macOS release is ready locally at " + RELEASE_METADATA_PATH);
console.log("Next: npm run release:publish:mac (uploads assets using gh, after review).");
