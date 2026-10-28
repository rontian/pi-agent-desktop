import assert from "node:assert/strict";
import test from "node:test";
import { isWrongSigningPassword, resolveSigningPassword } from "./local-signing-password.mjs";

test("valid exported password signs without prompting", async () => {
  const checked = [];
  const result = await resolveSigningPassword({
    initialPassword: "exported",
    verifyPassword: async (password) => { checked.push(password); },
    promptPassword: () => { throw new Error("Must not prompt for a valid environment password"); },
  });
  assert.equal(result, "exported");
  assert.deepEqual(checked, ["exported"]);
});

test("without environment password, prompt once and verify before building", async () => {
  let prompts = 0;
  const result = await resolveSigningPassword({
    verifyPassword: async (value) => assert.equal(value, "typed"),
    promptPassword: () => { prompts++; return "typed"; },
  });
  assert.equal(result, "typed");
  assert.equal(prompts, 1);
});

test("wrong exported password prompts once and revalidates the replacement", async () => {
  const seen = [];
  let prompted = 0;
  let warnings = 0;
  const result = await resolveSigningPassword({
    initialPassword: "wrong-exported",
    verifyPassword: async (value) => {
      seen.push(value);
      if (value === "wrong-exported") throw new Error("incorrect updater private key password: Wrong password for that key");
    },
    promptPassword: () => { prompted++; return "correct"; },
    onWrongPassword: () => { warnings++; },
  });
  assert.equal(result, "correct");
  assert.deepEqual(seen, ["wrong-exported", "correct"]);
  assert.equal(prompted, 1);
  assert.equal(warnings, 1);
});

test("repeated wrong passwords stop after three prompts", async () => {
  let prompts = 0;
  await assert.rejects(resolveSigningPassword({
    initialPassword: "wrong-env",
    verifyPassword: async () => { throw new Error("Wrong password for that key"); },
    promptPassword: () => { prompts++; return "wrong-typed"; },
  }), /incorrect after repeated attempts/);
  assert.equal(prompts, 3);
});

test("non-password signing errors are reported rather than prompting", async () => {
  let prompts = 0;
  await assert.rejects(resolveSigningPassword({
    initialPassword: "some-password",
    verifyPassword: async () => { throw new Error("failed to launch Tauri CLI"); },
    promptPassword: () => { prompts++; return "unused"; },
  }), /failed to launch Tauri CLI/);
  assert.equal(prompts, 0);
});

test("only explicit password failures can trigger another prompt", () => {
  assert.equal(isWrongSigningPassword(new Error("Wrong password for that key")), true);
  assert.equal(isWrongSigningPassword({ stderr: "incorrect updater private key password" }), true);
  assert.equal(isWrongSigningPassword(new Error("DMG bundling failed")), false);
  assert.equal(isWrongSigningPassword(new Error("Private key file not found")), false);
});
