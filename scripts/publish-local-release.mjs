#!/usr/bin/env node
// Publish the exact previously-built assets, not a silent rebuild. gh handles all asset uploads.
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rootDir, forkReleaseTag } from "./release-components.mjs";
import { RELEASE_METADATA_PATH, RELEASE_LATEST_PATH, verifyBuildAssets } from "./local-release.mjs";
import { verifyReusableBuild } from "./reuse-signed-release-build.mjs";
import { buildReleaseUploadUrl, formatSize, planReleaseUploads, uploadAssetWithProgress, verifyUploadedAsset } from "./release-upload.mjs";

const REPO = "rontian/pi-agent-desktop";
function capture(cmd, args) {
  return execFileSync(cmd, args, { cwd: rootDir, encoding: "utf8" }).trim();
}
function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: rootDir, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(cmd + " exited " + result.status);
}
function fetchRelease(tag) {
  const result = spawnSync("gh", ["api", "repos/" + REPO + "/releases/tags/" + tag], {
    cwd: rootDir, encoding: "utf8", maxBuffer: 5 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/\\bHTTP 404\\b/.test(result.stderr ?? "")) return null;
  throw new Error("Unable to retrieve release from GitHub: " + (result.stderr?.trim() || "exit " + result.status));
}
function validateDraft(release, tag) {
  if (!release || release.tag_name !== tag || !Number.isSafeInteger(release.id) ||
    !Array.isArray(release.assets) || !release.draft) {
    throw new Error("Release is missing, already published, or invalid; refusing to modify it.");
  }
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
if (metadata.repository !== REPO) {
  throw new Error("Build metadata does not match this repository. Re-run release:build:mac.");
}
if (metadata.commit !== head) {
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", metadata.commit, head], {
    cwd: rootDir, stdio: "ignore",
  });
  if (ancestor.error) throw ancestor.error;
  const changedPaths = capture("git", ["diff", "--name-only", "--no-renames", metadata.commit, head])
    .split(/\r?\n/).filter(Boolean);
  const previousLocalRelease = capture("git", ["show", metadata.commit + ":scripts/local-release.mjs"]);
  const currentLocalRelease = await readFile(join(rootDir, "scripts", "local-release.mjs"), "utf8");
  verifyReusableBuild({
    buildCommit: metadata.commit,
    currentCommit: head,
    isAncestor: ancestor.status === 0,
    changedPaths,
    previousLocalRelease,
    currentLocalRelease,
  });
  console.log("Reusing signed build from " + metadata.commit
    + "; main changed only release verification tooling. The release tag will point to the actual build commit.");
}
const version = JSON.parse(await readFile("src-tauri/pi-agent-desktop-package.json", "utf8")).version;
if (metadata.version !== version) throw new Error("Built version is no longer current. Rebuild.");
const paths = await verifyBuildAssets(metadata);
const tag = forkReleaseTag(version);
// Verify/create the exact build tag before opening or resuming the Draft.
const localTag = spawnSync("git", ["rev-parse", "-q", "--verify", "refs/tags/" + tag], { cwd: rootDir, encoding: "utf8" });
if (localTag.status === 0) {
  if (capture("git", ["rev-list", "-n", "1", tag]) !== metadata.commit) throw new Error("Existing tag points to another commit.");
} else {
  run("git", ["tag", "-a", tag, "-m", tag, metadata.commit]);
}
const remoteTag = capture("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag]);
if (!remoteTag) run("git", ["push", "origin", "refs/tags/" + tag]);
else if (capture("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag + "^{}"]).split(/\\s+/)[0] !== metadata.commit) {
  throw new Error("Remote release tag does not point to this commit.");
}
let release = fetchRelease(tag);
if (release === null) {
  console.log("Creating Draft Release " + tag + "...");
  run("gh", ["release", "create", tag, "--repo", REPO, "--verify-tag",
    "--title", "Pi Agent Desktop " + tag, "--generate-notes", "--draft"]);
  release = fetchRelease(tag);
} else {
  console.log("Resuming existing Draft Release " + tag + "; checking every asset SHA256.");
}
validateDraft(release, tag);
const planned = planReleaseUploads(release.assets, metadata, paths);
console.log("Draft " + tag + ": " + planned.filter((x) => x.alreadyUploaded).length + "/" + planned.length + " assets verified.");
let token;
for (const [index, item] of planned.entries()) {
  const prefix = "[" + (index + 1) + "/" + planned.length + "] " + item.expected.name;
  if (item.alreadyUploaded) {
    console.log(prefix + ": ✓ 已上传，大小及 SHA256 一致，跳过");
    continue;
  }
  console.log(prefix + ": 开始上传 " + formatSize(item.expected.size) + "；下方为 curl 实时传输百分比");
  // Token flows only through curl stdin. Never an argument, disk config or log.
  token ??= capture("gh", ["auth", "token"]);
  const uploadUrl = buildReleaseUploadUrl(release.upload_url, REPO, release.id, item.expected.name);
  const started = Date.now();
  const uploaded = await uploadAssetWithProgress({ uploadUrl, path: item.path, token });
  verifyUploadedAsset(uploaded, item.expected);
  release = fetchRelease(tag);
  validateDraft(release, tag);
  const remote = release.assets.filter((asset) => asset.name === item.expected.name);
  if (remote.length !== 1) throw new Error("GitHub did not retain exactly one " + item.expected.name + "; Draft preserved.");
  verifyUploadedAsset(remote[0], item.expected);
  const seconds = Math.max((Date.now() - started) / 1000, 0.001);
  console.log(prefix + ": ✓ 完成，SHA256 已校验，平均 " +
    (item.expected.size / 1048576 / seconds).toFixed(2) + " MiB/s");
}
release = fetchRelease(tag);
validateDraft(release, tag);
if (planReleaseUploads(release.assets, metadata, paths).some((x) => !x.alreadyUploaded)) {
  throw new Error("Not all release assets are uploaded; leaving Draft unpublished.");
}
console.log("All " + planned.length + " assets verified; publishing " + tag + "...");
run("gh", ["release", "edit", tag, "--repo", REPO, "--draft=false", "--prerelease=false", "--latest"]);
console.log("Published " + tag + " to https://github.com/" + REPO + "/releases/tag/" + tag);
