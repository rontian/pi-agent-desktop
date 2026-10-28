import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { rootDir, normalizeVersion, forkReleaseTag } from "./release-components.mjs";

export const RELEASE_REPO = "rontian/pi-agent-desktop";
export const RELEASE_DIR = join(rootDir, "src-tauri", "target", "release", "bundle");
export const RELEASE_METADATA_PATH = join(RELEASE_DIR, "local-release", "release-build.json");
export const RELEASE_LATEST_PATH = join(RELEASE_DIR, "local-release", "latest.json");
export const RELEASE_UPLOAD_DIR = join(RELEASE_DIR, "local-release", "assets");

export function uploadAssetPaths(version) {
  const v = normalizeVersion(version);
  return {
    dmg: join(RELEASE_UPLOAD_DIR, "Pi.Agent_" + v + "_aarch64.dmg"),
    archive: join(RELEASE_UPLOAD_DIR, "Pi.Agent.app.tar.gz"),
    signature: join(RELEASE_UPLOAD_DIR, "Pi.Agent.app.tar.gz.sig"),
  };
}

export function macReleaseAssets(version) {
  const normalized = normalizeVersion(version);
  return {
    dmg: join(RELEASE_DIR, "dmg", "Pi Agent_" + normalized + "_aarch64.dmg"),
    archive: join(RELEASE_DIR, "macos", "Pi Agent.app.tar.gz"),
    signature: join(RELEASE_DIR, "macos", "Pi Agent.app.tar.gz.sig"),
    componentManifest: join(rootDir, "src-tauri", "resources", "component-versions.json"),
  };
}

export function githubAssetUrl(version, filename) {
  return "https://github.com/" + RELEASE_REPO + "/releases/download/v"
    + forkReleaseTag(version) + "/" + encodeURIComponent(basename(filename));
}

export function createMacUpdaterManifest(version, signature) {
  const normalized = normalizeVersion(version);
  if (typeof signature !== "string" || !signature.trim()) {
    throw new Error("Updater signature is missing");
  }
  return {
    version: normalized,
    notes: "Pi Agent Desktop " + normalized + " (rontian fork)",
    pub_date: new Date().toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature: signature.trim(),
        url: githubAssetUrl(normalized, "Pi.Agent.app.tar.gz"),
      },
    },
  };
}

export async function describeFile(path) {
  const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
  if (!info.isFile() || info.size === 0) throw new Error("Missing or empty release asset: " + path);
  return {
    name: basename(path),
    size: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function verifyBuildAssets(metadata) {
  if (!metadata || typeof metadata !== "object") throw new Error("Invalid release-build.json");
  if (metadata.tag !== forkReleaseTag(metadata.version)) throw new Error("Release tag does not match Fork version");
  const paths = uploadAssetPaths(metadata.version);
  const selected = {
    dmg: paths.dmg,
    archive: paths.archive,
    signature: paths.signature,
    componentManifest: macReleaseAssets(metadata.version).componentManifest,
    latest: RELEASE_LATEST_PATH,
  };
  for (const [key, path] of Object.entries(selected)) {
    const actual = await describeFile(path);
    const expected = metadata.files?.[key];
    if (!expected || expected.sha256 !== actual.sha256 || expected.size !== actual.size
      || expected.name !== actual.name) throw new Error("Release asset changed since build: " + path);
  }
  const manifest = JSON.parse(await readFile(RELEASE_LATEST_PATH, "utf8"));
  const signature = (await readFile(paths.signature, "utf8")).trim();
  if (manifest.version !== metadata.version
    || manifest.platforms?.["darwin-aarch64"]?.signature !== signature
    || manifest.platforms?.["darwin-aarch64"]?.url !== githubAssetUrl(metadata.version, paths.archive)) {
    throw new Error("latest.json does not match the signed macOS updater artifact");
  }
  const components = JSON.parse(await readFile(paths.componentManifest, "utf8"));
  if (components.appVersion !== metadata.version
    || components.components?.find((x) => x.id === "pi-agent-desktop")?.repository !== RELEASE_REPO) {
    throw new Error("Component manifest does not match the fork release");
  }
  return selected;
}
