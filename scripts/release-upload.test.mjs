import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { rootDir } from "./release-components.mjs";
import {
  UPLOAD_KEYS, verifyUploadedAsset, planReleaseUploads, buildReleaseUploadUrl,
  buildCurlConfig, uploadAssetWithProgress,
} from "./release-upload.mjs";

function fixture() {
  const paths = {}, files = {};
  for (const key of UPLOAD_KEYS) {
    paths[key] = "/tmp/" + key + ".bin";
    files[key] = { name: key + ".bin", size: 12, sha256: "a".repeat(64) };
  }
  return {
    paths, metadata: { files },
    assets: UPLOAD_KEYS.map((key) => ({
      name: key + ".bin", state: "uploaded", size: 12, digest: "sha256:" + "a".repeat(64),
    })),
  };
}

test("five matching uploaded assets skip re-upload after verifying SHA256 and size", () => {
  const { paths, metadata, assets } = fixture();
  const plan = planReleaseUploads(assets, metadata, paths);
  assert.equal(plan.length, 5);
  assert.ok(plan.every((x) => x.alreadyUploaded));
});

test("interrupted Draft resumes only missing assets", () => {
  const { paths, metadata, assets } = fixture();
  const plan = planReleaseUploads(assets.slice(0, 2), metadata, paths);
  assert.deepEqual(plan.filter((x) => !x.alreadyUploaded).map((x) => x.key), UPLOAD_KEYS.slice(2));
});

test("invalid digest, size, state, duplicate, unknown asset, local path all fail closed", () => {
  const { paths, metadata, assets } = fixture();
  for (const patch of [
    { digest: "sha256:" + "b".repeat(64) }, { size: 0 },
    { state: "starter" }, { digest: null },
  ]) {
    assert.throws(() => planReleaseUploads([{ ...assets[0], ...patch }], metadata, paths), /does not match/);
  }
  const placeholder = planReleaseUploads([
    { ...assets[0], state: "starter", size: 0, id: 123 },
  ], metadata, paths)[0];
  assert.equal(placeholder.staleStarterId, 123);
  assert.equal(placeholder.alreadyUploaded, false);
  assert.throws(() => planReleaseUploads([assets[0], assets[0]], metadata, paths), /Duplicate/);
  assert.throws(() => planReleaseUploads([{ ...assets[0], name: "unknown" }], metadata, paths), /Unexpected/);
  assert.throws(() => planReleaseUploads([], { files: {} }, paths), /missing required/);
  assert.throws(() => planReleaseUploads([], metadata, { ...paths, dmg: "/tmp/wrong" }), /Invalid local/);
});

test("release-specific upload URL must exactly match the trusted GitHub host", () => {
  const url = "https://uploads.github.com/repos/rontian/pi-agent-desktop/releases/123/assets{?name,label}";
  assert.equal(buildReleaseUploadUrl(url, "rontian/pi-agent-desktop", 123, "Pi Agent.dmg"),
    "https://uploads.github.com/repos/rontian/pi-agent-desktop/releases/123/assets?name=Pi%20Agent.dmg");
  assert.throws(() => buildReleaseUploadUrl(url.replace("uploads.github.com", "bad.example"),
    "rontian/pi-agent-desktop", 123, "x"), /Unexpected/);
  assert.throws(() => buildReleaseUploadUrl(url, "rontian/pi-agent-desktop", 456, "x"), /Unexpected/);
});

test("curl authentication is passed only in stdin configuration, not argv", () => {
  const config = buildCurlConfig({
    uploadUrl: "https://uploads.github.com/example", path: "/tmp/space file",
    responsePath: "/tmp/response.json", token: "gho_TESTSECRET_123",
  });
  assert.match(config, /Authorization: Bearer gho_TESTSECRET_123/);
  assert.match(config, /data-binary = "@\/tmp\/space file"/);
  assert.throws(() => buildCurlConfig({
    uploadUrl: "u", path: "p", responsePath: "r", token: "abc\nmalicious",
  }), /token format/);
});

test("real local HTTP upload succeeds, checks response digest, never touches GitHub", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-upload-test-"));
  const bytes = Buffer.alloc(16384, "A");
  const file = join(dir, "sample file.bin");
  await writeFile(file, bytes);
  let receivedToken, receivedBytes;
  const server = createServer((req, res) => {
    receivedToken = req.headers.authorization;
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      receivedBytes = Buffer.concat(chunks);
      const response = {
        name: basename(file), state: "uploaded", size: receivedBytes.length,
        digest: "sha256:" + createHash("sha256").update(receivedBytes).digest("hex"),
      };
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + server.address().port + "/upload";
    const result = await uploadAssetWithProgress({
      uploadUrl: url, path: file, token: "gho_test", log: () => {}, heartbeatMs: 50,
    });
    assert.equal(receivedToken, "Bearer gho_test");
    assert.deepEqual(receivedBytes, bytes);
    verifyUploadedAsset(result, {
      name: basename(file), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("local HTTP upload 502 fails rather than falsely reporting success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-upload-fail-"));
  const file = join(dir, "payload.bin");
  await writeFile(file, "hello");
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => { res.writeHead(502); res.end("failed"); });
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await assert.rejects(uploadAssetWithProgress({
      uploadUrl: "http://127.0.0.1:" + server.address().port + "/",
      path: file, token: "gho_test", log: () => {},
    }), /Upload transport failed/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("publishing script wires all five assets, Draft resume and digest verification", async () => {
  const source = await readFile(join(rootDir, "scripts", "publish-local-release.mjs"), "utf8");
  assert.match(source, /fetchRelease\(tag\)/);
  assert.match(source, /validateDraft\(release, tag\)/);
  assert.match(source, /planReleaseUploads\(release\.assets, metadata, paths\)/);
  assert.match(source, /verifyUploadedAsset\(remote\[0\], item\.expected\)/);
  assert.match(source, /uploadAssetWithProgress/);
  assert.match(source, /--draft=false/);
  assert.doesNotMatch(source, /--clobber|push.*--force/);
});
