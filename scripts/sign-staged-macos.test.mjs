import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDeveloperIdReleaseEnvironment, findStagedMachOBinaries,
  isMachOBinary, signStagedMacResources,
} from "./sign-staged-macos.mjs";

const macho = Buffer.from("cffaedfe00000000", "hex");
const elf = Buffer.from("7f454c4600000000", "hex");

test("Apple notarization preflight requires Developer ID and one complete credential set", () => {
  const env = {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example (ABCDE12345)",
    APPLE_ID: "developer@example.com",
    APPLE_PASSWORD: "secret",
    APPLE_TEAM_ID: "ABCDE12345",
  };
  assert.equal(assertDeveloperIdReleaseEnvironment(env), env.APPLE_SIGNING_IDENTITY);
  assert.throws(() => assertDeveloperIdReleaseEnvironment({ ...env, APPLE_SIGNING_IDENTITY: "-" }), /Developer ID/);
  assert.throws(() => assertDeveloperIdReleaseEnvironment({ ...env, APPLE_PASSWORD: "" }), /Notarization requires/);
  assert.equal(assertDeveloperIdReleaseEnvironment({
    APPLE_SIGNING_IDENTITY: env.APPLE_SIGNING_IDENTITY,
    APPLE_API_KEY: "key",
    APPLE_API_ISSUER: "issuer",
    APPLE_API_KEY_PATH: "/private/key.p8",
  }), env.APPLE_SIGNING_IDENTITY);
});

test("native scan detects Mach-O executables, .node addons and dylibs but ignores non-Mach-O files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-macho-test-"));
  try {
    await mkdir(join(dir, "addon"), { recursive: true });
    await writeFile(join(dir, "addon", "pty.node"), macho);
    await writeFile(join(dir, "addon", "spawn-helper"), Buffer.from("feedfacf00000000", "hex"));
    await writeFile(join(dir, "addon", "other.so"), elf);
    await writeFile(join(dir, "config.json"), "hello");
    assert.equal(await isMachOBinary(join(dir, "addon", "pty.node")), true);
    assert.equal(await isMachOBinary(join(dir, "addon", "other.so")), false);
    const files = await findStagedMachOBinaries(dir);
    assert.deepEqual(files.map((p) => p.slice(dir.length + 1)).sort(), [
      "addon/pty.node", "addon/spawn-helper",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sign staged resources inside-out before Tauri signs its outer app", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-sign-test-"));
  try {
    const nested = join(dir, "server", "node_modules", "node-pty", "prebuilds", "darwin-arm64");
    const helper = join(dir, "Pi Agent Server.app");
    await mkdir(nested, { recursive: true });
    await mkdir(join(helper, "Contents", "MacOS"), { recursive: true });
    await writeFile(join(nested, "pty.node"), macho);
    await writeFile(join(nested, "spawn-helper"), macho);
    await writeFile(join(nested, "notes.md"), "# no signing");
    await writeFile(join(helper, "Contents", "MacOS", "node"), macho);
    const calls = [];
    const result = await signStagedMacResources({
      resourceDir: dir,
      identity: "Developer ID Application: Example (ABCDE12345)",
      entitlements: "/safe/helper-entitlements.plist",
      codesign: (args) => calls.push(args),
    });
    assert.equal(result.nativeFiles.length, 2);
    assert.equal(calls.length, 6);
    for (const args of [calls[0], calls[2], calls[4]]) {
      assert.ok(args.includes("--timestamp"), "secure timestamp on all embedded code");
      assert.ok(args.includes("runtime"), "hardened runtime on all embedded code");
    }
    assert.deepEqual(calls[4].slice(-3), ["--entitlements", "/safe/helper-entitlements.plist", helper]);
    assert.deepEqual(calls[5], ["--verify", "--deep", "--strict", "--verbose=2", helper]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing embedded native server binaries fail before costly notarization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-sign-missing-test-"));
  try {
    await mkdir(join(dir, "server"), { recursive: true });
    await assert.rejects(signStagedMacResources({
      resourceDir: dir,
      identity: "Developer ID Application: Example",
      codesign: () => {},
    }), /No native binaries/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
