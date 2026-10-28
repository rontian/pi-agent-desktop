// A locally published DMG may be Developer ID signed without Apple notarization.
// Remove *only* notarization credentials from the child Tauri build environment;
// keep the maintainer's terminal configuration unchanged.
const notarizationVariables = [
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
  "APPLE_API_KEY",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY_PATH",
];

export function localReleaseBuildEnvironment(environment, { keyFile, signingPassword, publicKey }) {
  const env = { ...environment };
  for (const variable of notarizationVariables) delete env[variable];
  return {
    ...env,
    TAURI_SIGNING_PRIVATE_KEY: keyFile,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: signingPassword,
    PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY: publicKey,
    APPLE_SIGNING_IDENTITY: environment.APPLE_SIGNING_IDENTITY || "-",
  };
}
