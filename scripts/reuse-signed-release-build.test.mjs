import assert from "node:assert/strict";
import test from "node:test";
import { ALLOWED_POST_BUILD_FILES, verifyReusableBuild } from "./reuse-signed-release-build.mjs";

const buildCommit = "a".repeat(40);
const currentCommit = "b".repeat(40);
const oldModule = [
  "export function buildManifest(version) { return version; }",
  "export async function verifyBuildAssets(metadata) { return metadata; }",
].join("\n");
const newModule = oldModule.replace(
  "return metadata;", "return { ...metadata, validated: true };",
);
const validReuse = {
  buildCommit, currentCommit, isAncestor: true,
  changedPaths: [
    "scripts/local-release.mjs",
    "scripts/publish-local-release.mjs",
    "scripts/reuse-signed-release-build.mjs",
    "scripts/reuse-signed-release-build.test.mjs",
    "scripts/verify-build-assets.test.mjs",
    "docs/fork-release.zh-CN.md",
  ],
  previousLocalRelease: oldModule, currentLocalRelease: newModule,
};

test("verification-only changes reuse the signed build, keeping its original commit", () => {
  assert.equal(verifyReusableBuild(validReuse), true);
  assert.deepEqual(validReuse.changedPaths.sort(),
    [...ALLOWED_POST_BUILD_FILES].sort());
});

test("same-commit publishing needs no waiver", () => {
  assert.equal(verifyReusableBuild({
    ...validReuse, currentCommit: buildCommit, isAncestor: false,
    changedPaths: ["app/main.ts"],
  }), false);
});

test("non-ancestor builds and source changes require a fresh build", () => {
  assert.throws(() => verifyReusableBuild({
    ...validReuse, isAncestor: false,
  }), /not an ancestor/);
  assert.throws(() => verifyReusableBuild({
    ...validReuse, changedPaths: [...validReuse.changedPaths, "src-tauri/src/main.rs"],
  }), /rebuild required/);
  assert.throws(() => verifyReusableBuild({
    ...validReuse, changedPaths: ["package-lock.json"],
  }), /rebuild required/);
});

test("changing asset naming or manifest generation forbids reuse", () => {
  assert.throws(() => verifyReusableBuild({
    ...validReuse,
    currentLocalRelease: newModule.replace("return version", "return version + 1"),
  }), /Build-time release asset logic changed/);
  assert.throws(() => verifyReusableBuild({
    ...validReuse, currentLocalRelease: "export function unrelated() {}",
  }), /Cannot locate verifyBuildAssets/);
});

test("invalid commit identifiers are rejected", () => {
  assert.throws(() => verifyReusableBuild({
    ...validReuse, buildCommit: "not-a-commit",
  }), /invalid/);
});
