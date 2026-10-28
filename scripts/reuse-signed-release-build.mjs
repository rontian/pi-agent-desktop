// Permit a completed, hashed/signature-verified macOS build to be published
// after fixes to the release verifier itself. Never substitute a newer source
// commit for the commit that actually produced the binary.
export const ALLOWED_POST_BUILD_FILES = new Set([
  "scripts/local-release.mjs",
  "scripts/publish-local-release.mjs",
  "scripts/reuse-signed-release-build.mjs",
  "scripts/reuse-signed-release-build.test.mjs",
  "scripts/verify-build-assets.test.mjs",
  "docs/fork-release.zh-CN.md",
]);

export function verifyReusableBuild({
  buildCommit, currentCommit, isAncestor, changedPaths,
  previousLocalRelease, currentLocalRelease,
}) {
  if (!/^[a-f0-9]{40}$/.test(buildCommit) || !/^[a-f0-9]{40}$/.test(currentCommit)) {
    throw new Error("Release build commit or main commit is invalid.");
  }
  if (buildCommit === currentCommit) return false;
  if (!isAncestor) throw new Error("Built commit is not an ancestor of main; rebuild required.");
  const changed = changedPaths.filter(Boolean);
  const disallowed = changed.filter((path) => !ALLOWED_POST_BUILD_FILES.has(path));
  if (disallowed.length > 0) {
    throw new Error("Application or non-verifier files changed since the signed build; rebuild required: " + disallowed.join(", "));
  }
  // The same local-release.mjs also defines manifest and asset naming used at
  // BUILD time. Only its verifyBuildAssets function may change after a build.
  const marker = "export async function verifyBuildAssets(";
  const prefix = (source) => {
    const pos = source.indexOf(marker);
    if (pos === -1) throw new Error("Cannot locate verifyBuildAssets; rebuild required.");
    return source.slice(0, pos);
  };
  if (prefix(previousLocalRelease) !== prefix(currentLocalRelease)) {
    throw new Error("Build-time release asset logic changed; rebuild required.");
  }
  return true;
}
