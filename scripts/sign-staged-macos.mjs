// Sign the native executables bundled as Tauri resources BEFORE Tauri signs the
// outer app. Tauri does not automatically sign arbitrary code inside Resources.
import { spawnSync } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rootDir } from "./release-components.mjs";

const MACHO_MAGICS = new Set([
  "feedface", "cefaedfe", "feedfacf", "cffaedfe",
  "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
]);

export function assertDeveloperIdReleaseEnvironment(env) {
  const identity = env.APPLE_SIGNING_IDENTITY?.trim();
  if (!identity || identity === "-") {
    throw new Error("A Developer ID Application identity is required for a notarized release (APPLE_SIGNING_IDENTITY).");
  }
  const appleId = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]
    .every((name) => Boolean(env[name]?.trim()));
  const apiKey = ["APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH"]
    .every((name) => Boolean(env[name]?.trim()));
  if (!appleId && !apiKey) {
    throw new Error("Notarization requires APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID, or all three APPLE_API_KEY variables.");
  }
  return identity;
}

export async function isMachOBinary(path) {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await file.read(header, 0, 4, 0);
    return bytesRead === 4 && MACHO_MAGICS.has(header.toString("hex"));
  } finally {
    await file.close();
  }
}

export async function findStagedMachOBinaries(root) {
  const found = [];
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      // Don't traverse symlinks into another package or sign a target twice.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && await isMachOBinary(path)) found.push(path);
    }
  }
  await visit(root);
  return found;
}

function runCodesign(args) {
  const result = spawnSync("codesign", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("codesign " + args.slice(0, -1).join(" ") + " failed for " + args.at(-1));
  }
}

export async function signStagedMacResources({
  identity,
  resourceDir = join(rootDir, "src-tauri", "resources"),
  entitlements = join(rootDir, "desktop", "server-helper-entitlements.plist"),
  codesign = runCodesign,
}) {
  if (!identity || identity === "-") throw new Error("Developer ID signing identity is required for embedded binaries.");
  const serverRoot = join(resourceDir, "server");
  const nativeFiles = await findStagedMachOBinaries(serverRoot);
  if (nativeFiles.length === 0) {
    throw new Error("No native binaries found in the staged server; refusing to notarize an unexpected bundle.");
  }
  for (const path of nativeFiles) {
    codesign(["--force", "--sign", identity, "--options", "runtime", "--timestamp", path]);
    codesign(["--verify", "--strict", "--verbose=2", path]);
  }

  // The bundled Node executable lives inside a second .app. Sign the helper
  // bundle (which signs its executable) after every other staged Mach-O file.
  const helper = join(resourceDir, "Pi Agent Server.app");
  const node = join(helper, "Contents", "MacOS", "node");
  if (!await isMachOBinary(node)) throw new Error("Bundled Node is not a valid Mach-O executable: " + node);
  codesign([
    "--force", "--sign", identity, "--options", "runtime", "--timestamp",
    "--entitlements", entitlements, helper,
  ]);
  codesign(["--verify", "--deep", "--strict", "--verbose=2", helper]);
  console.log("Signed " + nativeFiles.length + " staged Mach-O files and Pi Agent Server.app with Developer ID.");
  return { nativeFiles, helper };
}
