#!/usr/bin/env bash
# 手动同步 agegr/pi-web Release；有冲突时暂停，修复后 resume。
# 不自动准备/发布桌面版本，不向 main 推送，不调用 GitHub Actions。
set -euo pipefail

die() { printf '错误：%s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }
usage() {
  cat <<'EOF'
用法：
  bash scripts/sync-pi-web-local.sh start v0.12.2
  bash scripts/sync-pi-web-local.sh status
  bash scripts/sync-pi-web-local.sh resume
  bash scripts/sync-pi-web-local.sh abort

start  必须从干净工作区运行；在 main 上会创建独立功能分支。
       拉取上游 Release tag、报告与 Fork 的冲突风险、执行 Git 三方合并。
       遇冲突会暂停，不覆盖任何 Fork 文件。
resume 解决 Git 冲突并 git add 后继续；验证失败修复后也可重新运行。
abort  仅在合并尚未提交时执行 git merge --abort；不会 reset --hard。
EOF
}

command_name="${1:-}"
case "$command_name" in start|status|resume|abort) ;; *) usage; exit 2 ;; esac
git rev-parse --show-toplevel >/dev/null 2>&1 || die "请在 Git 仓库内运行"
cd "$(git rev-parse --show-toplevel)"
[[ -f scripts/fork-ownership.mjs && -f scripts/upstream-css-baseline.mjs ]] || die "当前目录不是 Pi Agent Desktop 源码"
state="$(git rev-parse --git-path pi-web-sync-state)"
branch="$(git symbolic-ref --quiet --short HEAD)" || die "请先切换到普通分支，不支持 detached HEAD"

get_state() { sed -n "s/^$1=//p" "$state" | head -n 1; }
require_state() { [[ -f "$state" ]] || die "没有待恢复的同步任务；请先 start"; }
require_branch() {
  [[ "$(get_state branch)" == "$branch" ]] || die "同步任务创建于分支 $(get_state branch)，请切回该分支后继续"
}
tag_ref() { printf 'refs/pi-web-sync/%s' "$1"; }
show_status() {
  if [[ ! -f "$state" ]]; then echo "没有进行中的同步任务。"; return; fi
  printf '同步版本：%s\n工作分支：%s\n阶段：%s\n' "$(get_state tag)" "$(get_state branch)" "$(get_state phase)"
  if [[ -n "$(git ls-files -u)" ]]; then
    echo "仍有冲突文件："
    git diff --name-only --diff-filter=U
  fi
  git status --short
}
verify() {
  local tag ref
  require_state
  require_branch
  tag="$(get_state tag)"
  ref="$(tag_ref "$tag")"
  [[ -z "$(git ls-files -u)" ]] || die "尚有未解决冲突；处理后 git add，再执行 resume"
  if [[ -f "$(git rev-parse --git-path MERGE_HEAD)" ]]; then
    log "完成 Git merge commit（仅限当前功能分支）"
    git -c core.editor=true commit -m "chore(pi): 合并 pi-web $tag"
  fi
  git merge-base --is-ancestor "$ref" HEAD || die "当前分支尚未包含 $tag，拒绝继续"
  printf 'tag=%s\nbranch=%s\nphase=verify\n' "$tag" "$branch" > "$state"
  log "更新上游 CSS 哈希基线；若失败请恢复两个上游 CSS 文件，勿改基线掩盖漂移"
  node scripts/upstream-css-baseline.mjs update "$ref"
  log "更新依赖锁文件（只更新当前分支，不调整桌面发行版本）"
  npm install
  npm run release:manifest
  log "运行测试、类型检查、lint、Fork drift、独立桌面 Web 构建"
  npm test
  npx tsc --noEmit
  npm run lint
  npm run drift
  PI_WEB_DESKTOP_BUILD=1 npm run build
  git diff --check
  rm -f "$state"
  cat <<'EOF'

同步验证命令已通过。请继续人工验证侧栏、命令补全、消息队列和界面字号。
检查变更后自行 git add/commit、推送 PR；此脚本不会推送或发布。
EOF
}
case "$command_name" in
  status) show_status ;;
  abort)
    require_state; require_branch
    if [[ -f "$(git rev-parse --git-path MERGE_HEAD)" ]]; then
      git merge --abort
      rm -f "$state"
      echo "已退出未提交的 Git merge。"
    else
      tag="$(get_state tag)"
      if [[ "$(get_state phase)" == merge ]] &&
         ! git merge-base --is-ancestor "$(tag_ref "$tag")" HEAD &&
         [[ -z "$(git status --porcelain)" ]]; then
        # A pre-merge error can leave a state file without creating MERGE_HEAD.
        rm -f "$state"
        echo "Git merge 尚未开始，已清理可恢复状态；工作分支保持不变。"
      else
        die "合并已经提交或工作区仍有改动，拒绝自动回滚；请在功能分支上人工检查"
      fi
    fi
    ;;
  resume)
    require_state; require_branch
    verify
    ;;
  start)
    [[ ! -e "$state" ]] || die "已有同步任务；运行 status 或 resume，必要时 abort"
    tag="${2:-}"
    [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本格式须为 v0.12.2 等 Release tag"
    [[ -z "$(git status --porcelain)" ]] || die "工作区存在未提交改动，请先提交或暂存到其他分支"
    [[ ! -f "$(git rev-parse --git-path MERGE_HEAD)" ]] || die "已有未完成的 merge"
    if [[ "$branch" == main ]]; then
      new_branch="codex/sync-pi-web-${tag}"
      if git show-ref --verify --quiet "refs/heads/$new_branch"; then
        die "本地已有 $new_branch；请切换过去后再执行 start"
      fi
      git switch -c "$new_branch"
      branch="$new_branch"
    fi
    if git config --get remote.pi-web-upstream.url >/dev/null 2>&1; then
      # Read the raw configured URL: "git remote get-url" applies url.*.insteadOf,
      # which is deliberately used by the offline integration test.
      actual="$(git config --get remote.pi-web-upstream.url)"
      [[ "$actual" == https://github.com/agegr/pi-web.git ]] || die "pi-web-upstream 指向 $actual，不是官方上游"
    else
      git remote add pi-web-upstream https://github.com/agegr/pi-web.git
    fi
    ref="$(tag_ref "$tag")"
    log "拉取上游 Release $tag"
    git fetch --no-tags pi-web-upstream "refs/tags/$tag:$ref"
    git rev-parse --verify "$ref^{commit}" >/dev/null || die "上游 tag 不是 Git commit"
    base="$(git merge-base HEAD "$ref")" || die "没有共同祖先；不允许无关历史合并"
    log "检查上游改动与 Fork 定制文件的交集"
    git diff --name-only "$base" "$ref" | node scripts/fork-ownership.mjs classify -
    printf 'tag=%s\nbranch=%s\nphase=merge\n' "$tag" "$branch" > "$state"
    log "执行三方合并（不会自动提交或覆盖冲突文件）"
    if ! git merge --no-commit --no-ff "$ref"; then
      cat <<'EOF'

合并遇到冲突，已暂停。请：
  git status
  # 逐个修复冲突，保留 Fork 的 app/native-theme.css、命令补全和消息队列
  git add <已解决的文件>
  bash scripts/sync-pi-web-local.sh resume

如需放弃尚未提交的合并：
  bash scripts/sync-pi-web-local.sh abort
EOF
      exit 1
    fi
    verify
    ;;
esac
