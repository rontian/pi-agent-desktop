# 本地半自动同步 pi-web（不发布桌面版本）

Fork 使用 `git merge` 同步 `agegr/pi-web` 的 Release tag，而非 submodule 或覆盖文件。
此脚本把仓库现有的 `fork-ownership.mjs`、CSS 基线、drift 和构建检查串起来；
**不运行 release:prepare、不递增桌面版本、不推送、不创建 Release**。

## 初次使用

在 macOS 上使用当前已有的 Node 22、npm、Git 和 mise 环境。**本轮脚本暂时只在
`codex/sync-pi-web-v0.12.2` 功能分支中，还没有合入 main**，首次测试需要先拉取该分支：

```bash
cd /Volumes/MY_Spaces/rontian/pi-agent-desktop
git fetch origin codex/sync-pi-web-v0.12.2
git switch -c codex/sync-pi-web-v0.12.2 --track origin/codex/sync-pi-web-v0.12.2
# 如果本地已经有该分支，改为 git switch 后 git pull --ff-only
bash scripts/sync-pi-web-local.sh start v0.12.2
```

等脚本经 PR 合入 `main` 后，以后可在干净的 `main` 上运行 `start v0.12.3` 等新 tag，
脚本会自动建立功能分支。也可以在现有干净功能分支上执行 `start`，
此时不会二次创建分支。
版本参数必须是明确的已发布 tag，避免不受控地追踪上游 main。

脚本从 `https://github.com/agegr/pi-web.git` 拉取指定 tag，
首先用 `scripts/fork-ownership.json` 报告风险，再执行真正的三方合并。

## 冲突时怎么继续

如果脚本提示冲突，它会停在 Git merge 状态，**不会自动选择 ours/theirs**：

```bash
git status
git diff --name-only --diff-filter=U
# 编辑逐个冲突文件后，标记解决
git add <已解决的文件>
bash scripts/sync-pi-web-local.sh resume
```

不要 `git reset --hard`，也不要对 `AppShell`、`SessionSidebar`、`ChatInput`、
`useAgentSession`、`rpc-manager` 之类的自定义文件批量使用 `git checkout --theirs`。
应保留 Fork 菜单、命令参数补全、发送队列、桌面窗口逻辑，并把上游新行为重新接入。

若完成合并后 CSS 基线验证失败，确认 `app/globals.css` 和 `app/settings.css`
与目标 pi-web tag 一致。Fork 的自定义样式属于 `app/native-theme.css`。
修好后重新运行 `resume`。如果 drift 失败，请更新实际风险说明和
`scripts/fork-ownership.json`，**不要通过调低风险等级绕过检查**。

## 测试失败时

```bash
bash scripts/sync-pi-web-local.sh status
# 按输出修正源码或测试
bash scripts/sync-pi-web-local.sh resume
```

`resume` 在合并尚未提交时创建 merge commit；之后只重做校验，不会重复合并。
校验包含 `npm install`、组件清单生成、测试、TypeScript、lint、drift、
独立 `.next-desktop` 构建和 `git diff --check`。测试失败时保留状态，供再次继续。

如果尚未创建 merge commit，可执行：

```bash
bash scripts/sync-pi-web-local.sh abort
```

这只调用 `git merge --abort`；一旦 merge commit 已创建，脚本拒绝自动回滚。
本脚本将运行状态放在 Git 私有目录，不会被提交到仓库；切换分支前先结束当前同步。

## 校验通过后

继续人工检查深浅主题、窄窗口、菜单键盘操作、
多级 `/issue` 等命令补全、消息队列、模型选择、字体和设置持久化。

```bash
git status
git diff --check
git add -A
git commit -m "chore(pi): 完成 pi-web v0.12.2 合并验证"
git push -u origin HEAD
gh pr create --repo rontian/pi-agent-desktop --base main
```

先审查 PR，再合并 main；**正式桌面 `0.7.8` 的准备、签名、构建和发布仍是之后独立的本地步骤**。

离线脚本状态机回归（模拟本地两分支冲突，不访问 GitHub、不发布）：

```bash
bash scripts/sync-pi-web-local.test.sh
```

备注：`.github/workflows/component-updates.yml` 当前仅支持手动触发。
这是本地人工控制的替代入口，不会修改 GitHub 工作流触发器。
