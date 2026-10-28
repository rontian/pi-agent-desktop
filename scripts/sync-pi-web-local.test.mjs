import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("local pi-web sync pauses on conflict, resumes and aborts safely", {
  skip: process.platform === "win32" ? "requires Bash and POSIX Git" : false,
  timeout: 60_000,
}, () => {
  const script = fileURLToPath(new URL("./sync-pi-web-local.test.sh", import.meta.url));
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    timeout: 55_000,
    env: process.env,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `offline sync failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: offline conflict\/resume\/abort/);
});
