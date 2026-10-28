#!/usr/bin/env node
// Publish the exact previously-built assets, not a silent rebuild. gh handles all asset uploads.
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { rootDir } from "./release-components.mjs";
import { RELEASE_METADATA_PATH, RELEASE_LATEST_PATH, verifyBuildAssets } from "./local-release.mjs";

const REPO = "rontian/pi-agent-desktop";
function capture(cmd, args) {
  return execFileSync(cmd, args, { cwd: rootDir, encoding: "utf8" }).trim();
}
function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: rootDir, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(cmd + " exited " + result.status);
}
const branch = capture("git", ["branch", "--show-current"]);
if (branch !== "main" || capture("git", ["status", "--porcelain"])) {
  throw new Error("Publish requires a clean local main checkout.");
}
const head = capture("git", ["rev-parse", "HEAD"]);
const remoteMain = capture("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
if (head !== remoteMain) throw new Error("Local main must equal origin/main before publishing.");
const origin = capture("git", ["remote", "get-url", "origin"]);
if (!/^(?:https:\/\/github\.com\/|git@github\.com:)rontian\/pi-agent-desktop(?:\.git)?\/?$/.test(origin)) {
  throw new Error("The origin remote is not rontian/pi-agent-desktop: " + origin);
}
run("gh", ["auth", "status"]);
const metadata = JSON.parse(await readFile(RELEASE_METADATA_PATH, "utf8"));
if (metadata.commit !== head || metadata.repository !== REPO) {
  throw new Error("Build metadata does not match this checkout. Re-run release:build:mac.");
}
const version = JSON.parse(await readFile("src-tauri/pi-agent-desktop-package.json", "utf8")).version;
if (metadata.version !== version) throw new Error("Built version is no longer current. Rebuild.");
const paths = await verifyBuildAssets(metadata);
const tag = "v" + version;
const exists = spawnSync("gh", ["release", "view", tag, "--repo", REPO], { cwd: rootDir, stdio: "ignore" });
if (exists.status === 0) throw new Error("Release " + tag + " already exists (possibly a draft). Inspect it before retrying.");
// Tag exactly this commit; avoid creating a different release tag on the server.
const localTag = spawnSync("git", ["rev-parse", "-q", "--verify", "refs/tags/" + tag], { cwd: rootDir, encoding: "utf8" });
if (localTag.status === 0) {
  if (capture("git", ["rev-list", "-n", "1", tag]) !== head) throw new Error("Existing tag points to another commit.");
} else {
  run("git", ["tag", "-a", tag, "-m", tag]);
}
const remoteTag = capture("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag]);
if (!remoteTag) run("git", ["push", "origin", "refs/tags/" + tag]);
else if (capture("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag + "^{}"]).split(/\s+/)[0] !== head) {
  throw new Error("Remote release tag does not point to this commit.");
}
const upload = [paths.dmg, paths.archive, paths.signature, paths.componentManifest, paths.latest];
run("gh", ["release", "create", tag, ...upload, "--repo", REPO, "--verify-tag",
  "--title", "Pi Agent Desktop " + tag, "--generate-notes", "--draft"]);
const uploaded = JSON.parse(capture("gh", ["release", "view", tag, "--repo", REPO, "--json", "assets"])).assets || [];
for (const file of upload) {
  const expected = metadata.files[file === RELEASE_LATEST_PATH ? "latest" :
    Object.entries(paths).find(([, value]) => value === file)?.[0]];
  if (!uploaded.some((asset) => asset.name === expected.name && asset.size === expected.size)) {
    throw new Error("Missing or mismatched uploaded asset " + expected.name + "; release left as draft.");
  }
}
run("gh", ["release", "edit", tag, "--repo", REPO, "--draft=false", "--prerelease=false", "--latest"]);
console.log("Published " + tag + " to https://github.com/" + REPO + "/releases/tag/" + tag);
