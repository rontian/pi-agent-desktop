# rontian/pi-agent-desktop：本地构建与独立发行

**唯一正式发行流程：在维护者自己的 Apple Silicon Mac 构建、签名、验证，再用 gh 上传到 rontian/pi-agent-desktop 的 GitHub Release。** GitHub 仅保存仓库和二进制资产；不使用 GitHub Actions 编译、签名或发布。旧的 release.yml 已禁用。

**Tag 规则：上游 `v0.7.7` 等标签属于同步源码，永不覆盖或强制推送；本 Fork 使用 `rontian-v<应用版本>`（首发 `rontian-v0.7.7`）。应用内部版本仍为 `0.7.7`。**

本 Fork 只跟踪自己的稳定 Release，Tauri Updater 也只访问 https://github.com/rontian/pi-agent-desktop/releases/latest/download/latest.json。桌面源码上游 abcwyc/pi-agent-desktop、Pi SDK（earendil-works/pi）与 pi-web（agegr/pi-web）仅作为**手动同步来源**。同步不等于发布。

## 两种签名

1. **Tauri Updater 密钥**：用于签名更新归档及在已安装 App 中验证。与 Apple 证书无关；必须在每个发行版本中使用相同的私钥。无有效 Tauri Updater 私钥就无法通过 App 内更新。
2. **macOS 签名 / 公证**：当前本地发布脚本默认设置 APPLE_SIGNING_IDENTITY=-（ad-hoc），用于个人受控环境。面向外部用户分发时，应设置 Apple Developer ID 并按 Tauri/Apple 官方说明完成 notarization。Updater 的签名不能替代公证。

保留现有 Pi Agent.app 和 bundle identifier com.abcwyc.pi-agent，避免改变既有系统数据目录；因此此 Fork 与同名上游 App 不能保证并存。正式升级前备份必要设置与会话文件，后者通常位于 ~/.pi/agent。

## 一次性准备：本地密钥和 gh

在 macOS 终端安装 Node 22.19+、Rust 1.85+、Xcode Command Line Tools、gh，然后运行：

```bash
npm ci
gh auth login
npx tauri signer generate -w ~/.tauri/rontian-pi-agent.key
```

生成带密码的 Tauri 密钥对，私钥路径为 ~/.tauri/rontian-pi-agent.key，公钥路径为 ~/.tauri/rontian-pi-agent.key.pub。请**单独、安全、离线备份密钥和密码**，不要存入 Git、脚本、仓库、终端命令历史或 GitHub Actions Secrets。此流程完全不需要 GitHub Actions Secrets。私钥丢失后已安装的旧版本无法验证新私钥生成的更新。

正式执行 `npm run release:build:mac` 时，如果没有预先设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，脚本会从交互式终端安全提示输入私钥密码（无回显）；**不需要手动 export**。如果明确需要非交互式调用，也可以自行预先设置该环境变量，但不要将密码写在命令行、脚本、`.env` 或 Git 中。

签名密钥的路径与公钥由脚本读取，**不需要手动导出 `TAURI_SIGNING_PRIVATE_KEY` 或 `PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY`**。签名构建脚本默认从上述密钥路径读取公钥和私钥；也可通过 PI_AGENT_RELEASE_KEY_PATH 指向其他可信路径。脚本只在本地子进程环境中注入公钥与密钥路径，不修改已跟踪的 tauri.conf.json。

## 日常手动同步上游

1. 以 origin/main 为基线创建同步分支，按 [fork-sync.zh-CN.md](./fork-sync.zh-CN.md) 合并桌面上游的更新。Pi SDK/ pi-web 升级另按仓库的组件来源处理。
2. 审查 [ownership-boundaries.md](./ownership-boundaries.md) 和 scripts/fork-ownership.json，确保本 Fork 的 UI/命令补全等扩展没有因合并丢失。
3. 运行必要测试，创建 PR，合并到 main。**上游同步不会自动发版。**
4. 在版本分支运行 `npm run release:prepare`：当前版本尚无本 Fork Release 时**原样保留**（首发 0.7.7），否则自动递增 patch（下一版 0.7.8）；并刷新组件清单。无需手改版本，也不要修改上游 tag。
5. 运行 `npm run release:check`，自动依次执行测试、TypeScript、lint、drift、发行组件校验和 diff check；将准备版本的 PR 合并 main。不要使用上游 `npm run release`（它负责 npm publish）。

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c release/next-desktop
npm ci
npm run release:prepare
npm run release:check
# 查看、提交、推送版本变更并通过 PR 合并到 main
```

`release:verify` 会核查 Pi SDK 与 pi-web 上游 Release / 人工固定版本，以及本 Fork 版本与组件清单。若固定旧组件，需要在 scripts/release-component-pins.json 中说明版本和原因。

## 本地测试安装包（无自动更新签名）

```bash
npm run desktop:build
```

使用 src-tauri/tauri.local.conf.json 关闭 Updater 归档签名，可生成 .app 和 .dmg。**该包不注册正式 Updater，不用于发布自动更新。** 如果只有 dmg 的 bundle_dmg.sh 失败但 .app 已成功，先检查：

```bash
hdiutil info
df -h . /tmp
npx tauri bundle --bundles dmg --config src-tauri/tauri.local.conf.json --verbose 2>&1 | tee /tmp/pi-agent-dmg.log
```

这会保留真正的底层错误。不要猜测原因，不要清理其它已挂载卷；特别注意工作目录在外置 /Volumes 下时的卷格式、权限和 hdiutil 临时目录。如果需要先只验证 App，可用 `npm run desktop:build:app` 绕开 DMG 阶段。此脚本仍需准备 Next.js standalone。

## 唯一正式发行流程：在 Mac 上构建、签名、上传

本地准备好的发行版本合入 main 后：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
# 密码变量需要事先使用 read -rs 设置好
npm run release:build:mac
```

`release:build:mac` 会：
- 强制当前为干净的 main / Apple Silicon Mac，检查密钥、公钥格式和密码；
- 运行完整 `npm run release:check`，再准备 Next.js standalone；
- 使用本地 Tauri 构建完整 App/DMG、签名的 `Pi Agent.app.tar.gz` 和 `.sig`；
- 通过临时命令行配置注入 Fork Updater 公钥，不写入受 Git 管理的 Tauri 配置；
- 生成 `src-tauri/target/release/bundle/local-release/latest.json`（仅 `darwin-aarch64`）及 `release-build.json`（版本、提交 SHA 和资产 SHA256）。

**若 DMG 制作失败，正式流程停止，不能上传旧的或不完整的资产。** 不要把只有本地无签名更新的 DMG 当成正式 Release。

审核打包产物后：

```bash
npm run release:publish:mac
```

`release:publish:mac` 检查：main 与 origin/main 完全一致、工作区干净、构建对应当前提交、资产哈希未变、Updater 签名与 latest.json 匹配、组件清单正确以及版本 tag 没有被其它 Release 使用。然后在本地创建并推送注释 tag（若已有则确认指向相同 commit），用 **gh** 创建 Draft Release 并上传五项资产：

- `Pi.Agent_<版本>_aarch64.dmg`
- `Pi.Agent.app.tar.gz`（本地脚本将 Tauri 产物复制并规范化的上传名称）
- `Pi.Agent.app.tar.gz.sig`
- `component-versions.json`
- `latest.json`

脚本核对远端资产名称与大小后才将 Draft 标记为 Latest。**仅发布 macOS Apple Silicon**：latest.json 不含 Windows / Linux 入口，这些平台不属于本地 Mac 发布范围。不签名的同名资产不得混入。

成功后：

```bash
gh release view "rontian-v$(node -p "require('./src-tauri/pi-agent-desktop-package.json').version")" --repo rontian/pi-agent-desktop
```

已有同名 Release/Draft 或 tag 指向不同提交时，脚本拒绝自动覆盖，绝不使用 `-f`，请人工核查已有资产、标签与构建来源。Release 资产默认使用 gh 的自动生成说明，可在发布前后使用 gh release edit 调整说明。

## 首次迁移与后续更新

首次从无 Updater 的本地 App 迁移：手动下载并安装一次本 Fork 正式签名版。其后的更高版本由 App 的设置页检查本 Fork 最新稳定 Release，并用内置公钥验证更新包签名。**不能**直接以未经验证的上游 Release 覆盖 Fork。

密钥丢失、泄露或需要更换：停止自动发布，安排受控的手动安装迁移；不要直接旋转密钥并指望旧 App 自动接受新签名。发生问题时只发布更高版本，不用同版本号重新覆盖 Release。

## 可选 Homebrew

本仓库 Casks/pi-agent.rb 是可选的。它不会自动跟随 gh Release 改写；如确实使用 Homebrew，可以在发布后根据 DMG 的 SHA256 调用 `node scripts/update-homebrew-cask.mjs <版本> <sha256>`，经审计另开 PR 更新 Cask。暂不应将上游 Homebrew tap 当作本 Fork 的安装源。

相关：[桌面打包说明](./desktop.zh-CN.md)、[上游同步](./fork-sync.zh-CN.md)、[版本检测](./desktop-updates.md)。
