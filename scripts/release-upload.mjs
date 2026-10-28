// Github Draft upload helper: validate remote SHA256 before any resume or publish.
// Uses curl's real transmitted-byte progress meter; never passes tokens in argv.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const UPLOAD_KEYS = ["dmg", "archive", "signature", "componentManifest", "latest"];

export function verifyUploadedAsset(asset, expected) {
  if (asset.name !== expected.name) throw new Error("Unexpected release asset name: " + asset.name);
  if (asset.state !== "uploaded" || asset.size !== expected.size ||
      asset.digest !== "sha256:" + expected.sha256) {
    throw new Error("Release asset " + asset.name + " does not match local SHA256, size or uploaded state; leaving Draft unchanged.");
  }
}

export function planReleaseUploads(remoteAssets, metadata, paths) {
  const expectedNames = new Set(UPLOAD_KEYS.map((key) => metadata.files[key]?.name));
  if (expectedNames.size !== UPLOAD_KEYS.length || expectedNames.has(undefined)) {
    throw new Error("Release metadata is missing required asset names or has duplicate names.");
  }
  const seen = new Set();
  for (const asset of remoteAssets) {
    if (!expectedNames.has(asset.name)) throw new Error("Unexpected asset " + asset.name + " in existing Draft; manual review required.");
    if (seen.has(asset.name)) throw new Error("Duplicate release asset " + asset.name + "; manual review required.");
    seen.add(asset.name);
  }
  return UPLOAD_KEYS.map((key) => {
    const expected = metadata.files[key];
    const path = paths[key];
    if (!path || basename(path) !== expected.name) throw new Error("Invalid local asset for " + key + ".");
    const remote = remoteAssets.find((asset) => asset.name === expected.name);
    if (remote) verifyUploadedAsset(remote, expected);
    return { key, path, expected, alreadyUploaded: Boolean(remote) };
  });
}

export function buildReleaseUploadUrl(uploadUrl, repo, releaseId, filename) {
  const prefix = "https://uploads.github.com/repos/" + repo + "/releases/" + releaseId + "/assets";
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0 ||
      uploadUrl !== prefix + "{?name,label}") {
    throw new Error("Unexpected GitHub release upload URL; refusing to send credentials.");
  }
  return prefix + "?name=" + encodeURIComponent(filename);
}

function curlQuote(value) {
  if (/[\r\n]/.test(value)) throw new Error("Invalid newline in curl configuration value.");
  return '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

export function buildCurlConfig({ uploadUrl, path, responsePath, token }) {
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error("Invalid GitHub token format.");
  return [
    "url = " + curlQuote(uploadUrl),
    "header = " + curlQuote("Authorization: Bearer " + token),
    'header = "Accept: application/vnd.github+json"',
    'header = "Content-Type: application/octet-stream"',
    "data-binary = " + curlQuote("@" + path),
    "output = " + curlQuote(responsePath),
    'write-out = "%{http_code}"',
    'request = "POST"',
  ].join("\n") + "\n";
}

// Curl progress is bytes transmitted by the client, not GitHub's storage ACK.
export async function uploadAssetWithProgress({ uploadUrl, path, token, spawnProcess = spawn, log = console.log, heartbeatMs = 15000 }) {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-release-upload-"));
  const responsePath = join(dir, "upload-response.json");
  try {
    const args = ["--config", "-", "--progress-bar", "--show-error",
      "--connect-timeout", "30", "--fail", "--no-location"];
    const child = spawnProcess("curl", args, { stdio: ["pipe", "pipe", "inherit"] });
    const config = buildCurlConfig({ uploadUrl, path, token, responsePath });
    const started = Date.now();
    let statusOutput = "";
    const completion = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.on("data", (chunk) => {
        statusOutput += chunk.toString();
        if (statusOutput.length > 1024) reject(new Error("Unexpectedly large curl status output."));
      });
      child.once("close", (exitCode) => {
        if (exitCode === 0) resolve();
        else reject(new Error("Upload transport failed (curl exit " + exitCode + "); Draft preserved. Retry publish to resume."));
      });
      child.stdin.on("error", reject);
    });
    child.stdin.end(config);
    const heartbeat = setInterval(() => {
      log("  ... " + basename(path) + " 上传中 " + Math.floor((Date.now() - started) / 1000) +
        " 秒；传输进度见 curl 进度条，GitHub 确认仍待完成");
    }, heartbeatMs);
    try { await completion; } finally { clearInterval(heartbeat); }
    const status = statusOutput.trim();
    if (status !== "201") throw new Error("GitHub asset upload returned HTTP " + (status || "unknown") + "; Draft preserved.");
    return JSON.parse(await readFile(responsePath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function formatSize(bytes) {
  return bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + " KiB" : (bytes / 1048576).toFixed(1) + " MiB";
}
