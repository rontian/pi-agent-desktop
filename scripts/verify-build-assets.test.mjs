import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { forkReleaseTag } from "./release-components.mjs";
import {
  createMacUpdaterManifest, describeFile, verifyBuildAssets,
} from "./local-release.mjs";

test("valid existing signed release assets pass real file verification", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-agent-release-assets-"));
  const version = "0.7.7";
  const selectedPaths = {
    dmg: join(temp, "Pi.Agent_0.7.7_aarch64.dmg"),
    archive: join(temp, "Pi.Agent.app.tar.gz"),
    signature: join(temp, "Pi.Agent.app.tar.gz.sig"),
    componentManifest: join(temp, "component-versions.json"),
    latest: join(temp, "latest.json"),
  };
  try {
    const signature = "updater-test-signature";
    await Promise.all([
      writeFile(selectedPaths.dmg, "signed dmg bytes"),
      writeFile(selectedPaths.archive, "updater archive bytes"),
      writeFile(selectedPaths.signature, signature + "\n"),
      writeFile(selectedPaths.latest,
        JSON.stringify(createMacUpdaterManifest(version, signature)) + "\n"),
      writeFile(selectedPaths.componentManifest, JSON.stringify({
        appVersion: version,
        components: [{ id: "pi-agent-desktop", repository: "rontian/pi-agent-desktop", version }],
      }) + "\n"),
    ]);
    const files = {};
    for (const [key, path] of Object.entries(selectedPaths)) files[key] = await describeFile(path);
    const metadata = { version, tag: forkReleaseTag(version), files };
    assert.deepEqual(await verifyBuildAssets(metadata, { selectedPaths }), selectedPaths);

    await writeFile(selectedPaths.componentManifest, JSON.stringify({
      appVersion: version, components: [{ id: "pi-agent-desktop", repository: "other/repo", version }],
    }));
    files.componentManifest = await describeFile(selectedPaths.componentManifest);
    await assert.rejects(
      verifyBuildAssets(metadata, { selectedPaths }), /Component manifest does not match/,
    );
    await writeFile(selectedPaths.dmg, "corrupted dmg bytes");
    await assert.rejects(
      verifyBuildAssets(metadata, { selectedPaths }), /Release asset changed since build/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
