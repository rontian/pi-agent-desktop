import assert from "node:assert/strict";
import test from "node:test";
import { localReleaseBuildEnvironment } from "./local-release-signing-env.mjs";

const credentials = {
  APPLE_ID: "someone@example.com",
  APPLE_PASSWORD: "application-specific-password",
  APPLE_TEAM_ID: "ABCDE12345",
  APPLE_API_KEY: "KEY_ID",
  APPLE_API_ISSUER: "ISSUER_ID",
  APPLE_API_KEY_PATH: "/private/key.p8",
};
const signing = {
  keyFile: "/private/tauri.key",
  signingPassword: "tauri-signing-password",
  publicKey: "updater-public-key",
};

test("local release removes both Apple notarization credential sets", () => {
  const original = {
    ...credentials,
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example (ABCDE12345)",
    CUSTOM_SETTING: "keep-me",
  };
  const child = localReleaseBuildEnvironment(original, signing);
  for (const name of Object.keys(credentials)) {
    assert.equal(Object.hasOwn(child, name), false, `${name} must not reach Tauri`);
    assert.equal(original[name], credentials[name], "calling shell environment is not mutated");
  }
  assert.equal(child.APPLE_SIGNING_IDENTITY, original.APPLE_SIGNING_IDENTITY);
  assert.equal(child.TAURI_SIGNING_PRIVATE_KEY, signing.keyFile);
  assert.equal(child.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, signing.signingPassword);
  assert.equal(child.PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY, signing.publicKey);
  assert.equal(child.CUSTOM_SETTING, "keep-me");
});

test("without Developer ID identity, the personal installer retains ad-hoc fallback", () => {
  const env = localReleaseBuildEnvironment(credentials, signing);
  assert.equal(env.APPLE_SIGNING_IDENTITY, "-");
  assert.equal(Object.hasOwn(env, "APPLE_PASSWORD"), false);
});
