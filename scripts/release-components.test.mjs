import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersions,
  createComponentManifest,
  isReleasePinValid,
  nextDesktopVersion,
  nextPatchVersion,
  nextManualDesktopVersion,
  normalizeVersion,
  forkReleaseTag,
  fetchRecentReleases,
} from "./release-components.mjs";

test("normalizes GitHub release tags", () => {
  assert.equal(normalizeVersion("v0.81.1"), "0.81.1");
  assert.equal(normalizeVersion("rontian-v0.7.7"), "0.7.7");
  assert.equal(forkReleaseTag("0.7.7"), "rontian-v0.7.7");
  assert.equal(normalizeVersion("0.7.17"), "0.7.17");
  assert.throws(() => normalizeVersion("latest"), /Invalid release version/);
});

test("compares stable and prerelease versions", () => {
  assert.equal(compareVersions("0.81.1", "0.81.0"), 1);
  assert.equal(compareVersions("0.81", "0.81.0"), 0);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.10"), 1);
});

test("bumps the patch version", () => {
  assert.equal(nextPatchVersion("v0.1.0"), "0.1.1");
  assert.equal(nextPatchVersion("1.2"), "1.2.1");
});

test("never reuses a released version, including a prerelease", () => {
  assert.equal(nextDesktopVersion("0.7.3", ["0.7.2", "0.7.3"]), "0.7.4");
  // 0.7.4 is prepared locally but not released yet: another sync keeps it.
  assert.equal(nextDesktopVersion("0.7.4", ["0.7.2", "0.7.3"]), "0.7.4");
  assert.equal(nextDesktopVersion("0.7.4", ["0.7.3", "0.7.4"]), "0.7.5");
  assert.equal(nextDesktopVersion("0.7.7", []), "0.7.7");
  assert.equal(nextDesktopVersion("0.7.7", ["0.7.8"]), "0.7.9");
  assert.equal(nextDesktopVersion("0.7.3", ["0.7.2", "0.7.3", "0.7.4-rc.1"]), "0.7.5");
});

test("Fork release discovery ignores upstream tags imported by synchronization", async () => {
  const releases = await fetchRecentReleases("rontian/pi-agent-desktop", {
    fetcher: async () => new Response(JSON.stringify([
      {tag_name: "v0.7.7", draft: false},
      {tag_name: "rontian-v0.7.7", draft: false},
      {tag_name: "rontian-v0.7.8", draft: true},
    ]), { status: 200 }),
  });
  assert.deepEqual(releases.map((x) => x.version), ["0.7.7"]);
});

test("manual fork releases advance past the local and latest published version", () => {
  assert.equal(nextManualDesktopVersion("0.7.7", []), "0.7.8");
  assert.equal(nextManualDesktopVersion("0.7.7", ["0.7.9", "0.7.8"]), "0.7.10");
  assert.equal(nextManualDesktopVersion("0.7.10", ["0.7.9"]), "0.7.11");
});

test("only accepts explicit pins for the exact bundled component version", () => {
  assert.equal(isReleasePinValid({ version: "0.8.7", reason: "Fork compatibility review" }, "0.8.7"), true);
  assert.equal(isReleasePinValid({ version: "0.8.8", reason: "Wrong version" }, "0.8.7"), false);
  assert.equal(isReleasePinValid({ version: "0.8.7", reason: "" }, "0.8.7"), false);
});

test("writes an auditable three-component manifest", () => {
  assert.deepEqual(
    createComponentManifest({ "pi-agent-desktop": "0.1.0", pi: "0.81.1", "pi-web": "0.7.17" }),
    {
      schemaVersion: 1,
      appVersion: "0.1.0",
      components: [
        { id: "pi-agent-desktop", repository: "rontian/pi-agent-desktop", version: "0.1.0" },
        { id: "pi", repository: "earendil-works/pi", version: "0.81.1" },
        { id: "pi-web", repository: "agegr/pi-web", version: "0.7.17" },
      ],
    },
  );
});
