import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { componentRepositories, nextDesktopVersion, rootDir } from "./release-components.mjs";

const read = (path) => readFile(join(rootDir, path), "utf8");

test("fork release sources are independent from desktop upstream", async () => {
  assert.equal(componentRepositories["pi-agent-desktop"], "rontian/pi-agent-desktop");
  assert.equal(componentRepositories.pi, "earendil-works/pi");
  assert.equal(componentRepositories["pi-web"], "agegr/pi-web");
  const tauri = JSON.parse(await read("src-tauri/tauri.conf.json"));
  assert.deepEqual(tauri.plugins.updater.endpoints, [
    "https://github.com/rontian/pi-agent-desktop/releases/latest/download/latest.json",
  ]);
  assert.equal(tauri.bundle.createUpdaterArtifacts, true);
  const branding = await read("lib/branding.ts");
  assert.match(branding, /APP_REPOSITORY = "rontian\/pi-agent-desktop"/);
  assert.doesNotMatch(branding, /APP_REPOSITORY = "abcwyc\/pi-agent-desktop"/);
});

test("local packaging cannot demand the production updater signing key", async () => {
  const local = JSON.parse(await read("src-tauri/tauri.local.conf.json"));
  assert.equal(local.bundle.createUpdaterArtifacts, false);
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["desktop:build"], /tauri\.local\.conf\.json/);
  assert.doesNotMatch(pkg.scripts["release:prepare"], /--next-patch/);
  assert.match(pkg.scripts["release:check"], /npm test.*tsc --noEmit.*npm run lint.*npm run drift.*release:verify/);
  assert.equal(nextDesktopVersion("0.7.7", []), "0.7.7");
});

test("GitHub Actions release is disabled; macOS release uses local gh scripts", async () => {
  const workflow = await read(".github/workflows/release.yml");
  assert.match(workflow, /build:\s*\n\s*if: false/);
  assert.match(workflow, /manifest:\s*\n\s*needs: build/);
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["release:build:mac"], /build-local-release\.mjs/);
  assert.match(pkg.scripts["release:publish:mac"], /publish-local-release\.mjs/);
  assert.match(pkg.scripts["desktop:build:app"], /--bundles app/);
});

test("local updater manifest targets the signed macOS archive on this fork", async () => {
  const { createMacUpdaterManifest, githubAssetUrl } = await import("./local-release.mjs");
  const data = createMacUpdaterManifest("0.7.8", "signature-example");
  assert.equal(data.version, "0.7.8");
  assert.deepEqual(Object.keys(data.platforms), ["darwin-aarch64"]);
  assert.equal(data.platforms["darwin-aarch64"].signature, "signature-example");
  assert.equal(data.platforms["darwin-aarch64"].url,
    "https://github.com/rontian/pi-agent-desktop/releases/download/rontian-v0.7.8/Pi.Agent.app.tar.gz");
  assert.equal(githubAssetUrl("0.7.8", "Pi.Agent.app.tar.gz"),
    data.platforms["darwin-aarch64"].url);
  assert.throws(() => createMacUpdaterManifest("0.7.8", ""), /signature/i);
  const publishScript = await read("scripts/publish-local-release.mjs");
  assert.match(publishScript, /forkReleaseTag\(version\)/);
  assert.doesNotMatch(publishScript, /push.*--force|push.*-f/);
});
