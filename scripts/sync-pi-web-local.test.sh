#!/usr/bin/env bash
# Offline integration test for the local sync state machine. Requires Git, Bash, Node.
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/sync-pi-web-local.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
make_fixture() {
  local name="$1" base="$tmp/$name/fork" up="$tmp/$name/upstream"
  mkdir -p "$base/scripts" "$base/mock-bin"
  cp "$script" "$base/scripts/sync-pi-web-local.sh"
  echo base > "$base/shared.txt"
  cat > "$base/scripts/fork-ownership.mjs" <<'EOF'
process.stdin.resume(); // fixture accepts the overlap report.
EOF
  cat > "$base/scripts/upstream-css-baseline.mjs" <<'EOF'
process.exitCode = 0; // fixture bypasses actual CSS hashing.
EOF
  cat > "$base/mock-bin/npm" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cp "$base/mock-bin/npm" "$base/mock-bin/npx"
  chmod +x "$base/mock-bin/"*
  git init -q -b main "$base"
  git -C "$base" config user.name "Pi Sync Test"
  git -C "$base" config user.email "sync-test@example.invalid"
  git -C "$base" add -A
  git -C "$base" commit -qm base
  git clone -q "$base" "$up"
  git -C "$up" config user.name "Pi Upstream Test"
  git -C "$up" config user.email "sync-test@example.invalid"
  echo upstream > "$up/shared.txt"
  git -C "$up" commit -qam upstream
  git -C "$up" tag -a v0.12.2 -m release
  echo fork > "$base/shared.txt"
  git -C "$base" commit -qam fork
  # Keep the production script's official remote URL unchanged; rewrite it to
  # our local fixture only inside this throwaway Git repository.
  git -C "$base" config "url.file://$up.insteadOf" "https://github.com/agegr/pi-web.git"
}
run_sync() {
  local base="$1"
  ( cd "$base" && PATH="$base/mock-bin:$PATH" bash scripts/sync-pi-web-local.sh "${@:2}" )
}

make_fixture conflict
base="$tmp/conflict/fork"
if run_sync "$base" start v0.12.2 >"$tmp/start.log" 2>&1; then
  fail "expected a merge conflict"
fi
[[ "$(git -C "$base" branch --show-current)" == "codex/sync-pi-web-v0.12.2" ]] || fail "must use a feature branch"
[[ -f "$base/.git/pi-web-sync-state" ]] || fail "missing resumable state"
[[ "$(git -C "$base" diff --name-only --diff-filter=U)" == shared.txt ]] || fail "conflict not preserved"
echo resolved > "$base/shared.txt"
git -C "$base" add shared.txt
run_sync "$base" resume >"$tmp/resume.log" 2>&1 || { cat "$tmp/resume.log"; fail "resume failed"; }
git -C "$base" merge-base --is-ancestor refs/pi-web-sync/v0.12.2 HEAD || fail "upstream history not merged"
[[ ! -e "$base/.git/pi-web-sync-state" ]] || fail "state not cleaned"
[[ "$(cat "$base/shared.txt")" == resolved ]] || fail "manual resolution lost"

make_fixture abort
base="$tmp/abort/fork"
if run_sync "$base" start v0.12.2 >"$tmp/abort-start.log" 2>&1; then
  fail "expected a merge conflict before abort"
fi
run_sync "$base" abort >"$tmp/abort.log" 2>&1 || fail "abort failed"
[[ ! -e "$base/.git/pi-web-sync-state" ]] || fail "abort left state behind"
[[ ! -e "$base/.git/MERGE_HEAD" ]] || fail "abort left merge running"
[[ "$(cat "$base/shared.txt")" == fork ]] || fail "abort lost local work"
echo "PASS: offline conflict/resume/abort; upstream history retained, main untouched, no publish"
