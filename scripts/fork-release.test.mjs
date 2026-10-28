import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { componentRepositories, nextManualDesktopVersion, rootDir } from "./release-components.mjs";

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
  assert.match(pkg.scripts["release:prepare"], /--next-patch/);
  assert.equal(nextManualDesktopVersion("0.7.7", []), "0.7.8");
});

test("signed GitHub release requires fork keys and keeps whole-matrix publication gate", async () => {
  const workflow = await read(".github/workflows/release.yml");
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /TAURI_UPDATER_PUBLIC_KEY/);
  assert.match(workflow, /PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY/);
  assert.match(workflow, /uploadUpdaterJson: true/);
  assert.match(workflow, /manifest:\s*\n\s*needs: build/);
  assert.match(workflow, /--draft=false --latest --prerelease=false/);
  assert.doesNotMatch(workflow, /abcwyc\/pi-agent-desktop/);
});
