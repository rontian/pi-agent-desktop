import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function isWrongSigningPassword(error) {
  const details = [error?.message, error?.stderr, error?.stdout]
    .map((part) => part?.toString() ?? "")
    .join("\n");
  return /wrong password|incorrect updater private key password|incorrect password|invalid password/i.test(details);
}

/**
 * Prefer an already exported password. If Tauri rejects it, prompt in a TTY;
 * fail on unrelated errors instead of masking a broken toolchain.
 */
export async function resolveSigningPassword({
  initialPassword,
  verifyPassword,
  promptPassword,
  maxPrompts = 3,
  onWrongPassword = () => {},
}) {
  if (typeof verifyPassword !== "function" || typeof promptPassword !== "function") {
    throw new TypeError("Signing password validation and prompting must be provided");
  }
  let password = initialPassword || null;
  let prompts = 0;
  while (true) {
    if (password === null) {
      if (prompts >= maxPrompts) throw new Error("Signing password incorrect after repeated attempts.");
      password = await promptPassword();
      prompts++;
      if (!password) throw new Error("Signing password cannot be empty.");
    }
    try {
      await verifyPassword(password);
      return password;
    } catch (error) {
      if (!isWrongSigningPassword(error)) throw error;
      onWrongPassword();
      password = null;
    }
  }
}

export function promptSigningPassword() {
  const command = [
    "IFS= read -r -s -p 'Tauri Updater signing password: ' password </dev/tty || exit 1",
    "printf '\\n' >/dev/tty",
    "printf '%s' \"$password\"",
  ].join("\n");
  try {
    const value = execFileSync("/bin/bash", ["-c", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (!value) throw new Error("Signing password cannot be empty.");
    return value;
  } catch {
    throw new Error("Cannot read signing password from the interactive terminal; check /dev/tty or set TAURI_SIGNING_PRIVATE_KEY_PASSWORD.");
  }
}

export async function verifySigningPasswordWithTauri({ rootDir, keyFile, password }) {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-updater-sign-check-"));
  const probe = join(dir, "probe.txt");
  try {
    await writeFile(probe, "Pi Agent local updater signing preflight\n");
    const env = {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    };
    // signer sign uses --private-key-path, unlike tauri build which accepts a
    // file path in TAURI_SIGNING_PRIVATE_KEY. Do not allow conflicting options.
    delete env.TAURI_SIGNING_PRIVATE_KEY;
    delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
    const result = spawnSync("npx", [
      "--no-install", "tauri", "signer", "sign",
      "--private-key-path", keyFile, probe,
    ], {
      cwd: rootDir,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const error = new Error(
        "Tauri signing preflight failed: " + (result.stderr?.trim() || result.stdout?.trim() || "exit " + result.status),
      );
      error.stderr = result.stderr;
      error.stdout = result.stdout;
      throw error;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
