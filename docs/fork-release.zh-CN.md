# rontian/pi-agent-desktop 独立发行手册

本仓库以 **手动同步上游 → 审计与测试 → 合并 main → 手动准备版本 → 正式发布** 为唯一发行流程。**不会**因为上游出现 Release 就自动替换本 Fork 的安装包。

## 三类来源与两个更新阶段

- 桌面应用源码上游：`abcwyc/pi-agent-desktop`。按 [上游同步手册](./fork-sync.zh-CN.md) 在独立分支手动合并，不能重置 `main`。
- Pi SDK：`earendil-works/pi`；Web UI：`agegr/pi-web`。现有 `component-updates.yml` 可**手动**触发，也可自行在同步分支完成对应升级。脚本只负责这些组件，不等于同步桌面上游。
- **本 Fork 的发布与更新源**：`rontian/pi-agent-desktop`。设置页只检查这个仓库的最新稳定 Release；Tauri Updater 也只下载这里的 `latest.json`。上游版本升级必须先合入本 Fork 并发布新的完整 App，才会被安装。

版本提示与下载安装是不同链路。正式安装包内嵌本 Fork 的 Updater 公钥，以该公钥验证本 Fork 私钥签署的更新归档；签名不匹配就拒绝安装。已安装的无 Updater 本地构建，**需要手动安装一次本 Fork 正式签名 Release**，之后才能在设置中自动升级。

### 当前 App 身份

保留现有应用名 `Pi Agent.app` 和 Bundle Identifier `com.abcwyc.pi-agent`，避免意外改变本机应用数据目录。这意味着**不能**将本 Fork 与上游同名 App 视为无冲突共存：安装时会覆盖 `/Applications/Pi Agent.app`。以后若需要并存，再另开迁移分支同时处理产品名、Bundle ID、资源名和升级迁移。Pi 会话、模型与认证通常在 `~/.pi/agent`，但升级/卸载前仍应备份。

## 一次性设置（只在建立发行版时）

1. 在 GitHub 仓库 `rontian/pi-agent-desktop` 的 **Actions** 页面启用工作流。确认工作流可以读取仓库并创建 Release；Release 工作流自身申请 `contents: write`。若组织或仓库策略禁用 Actions/写权限，先在 Settings 中启用。
2. 在可信的本机安装项目依赖，生成 **你自己的** Tauri Updater 密钥：
   ```bash
   npm ci
   npx tauri signer generate -w ~/.tauri/rontian-pi-agent.key
   ```
   该命令会创建私钥以及对应的 `.pub` 公钥文件。设好私钥密码，并在离线安全介质备份。**不上传 Git、PR、日志或公开文件**。
3. GitHub 仓库 **Settings → Secrets and variables → Actions → Repository secrets** 创建：
   - `TAURI_SIGNING_PRIVATE_KEY`：刚才生成的私钥内容；
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成密钥时使用的密码；
   - `TAURI_UPDATER_PUBLIC_KEY`：`.pub` 文件的完整 Base64 文本。
4. 正式 `.github/workflows/release.yml` 会在构建机校验公钥，将其注入 Tauri 配置和 Rust 编译期，并由私钥为 Updater 产物签名。不要提交经过公钥注入的 `tauri.conf.json` 构建临时修改。
5. macOS 当前使用 ad-hoc 签名（`APPLE_SIGNING_IDENTITY=-`），**不是** Apple Developer ID 签名或公证。仅适合自用/受控分发。若面向外部用户，按 Tauri 与 Apple 官方流程配置开发者证书和 notarization；Windows Authenticode 也需要另配。Updater 签名不替代操作系统签名。

私钥损坏或丢失会阻止已安装版本接受新签名；恢复时只能使用原密钥或让用户手动换装新的发行版。**不得为了消除报错把 Updater 证书校验关闭**。

## 日常：手动同步上游、准备新版本

1. 基于最新 `origin/main` 建同步分支，按 `docs/fork-sync.zh-CN.md` 合并桌面上游；Pi SDK / pi-web 可使用手动 `component-updates.yml`。检查 `docs/ownership-boundaries.md` 和 `scripts/fork-ownership.json`，保留本 Fork 设计。经 PR 审计、测试后合入 `main`。**同步本身不会发行新版。**
2. 需要对用户发布时，新建版本分支（不要直接在 `main` 工作），运行：
   ```bash
   git fetch origin
   git switch main
   git pull --ff-only origin main
   git switch -c release/next-desktop
   npm ci
   npm run release:prepare
   ```
   `release:prepare` **主动递增一次 patch**：选择大于当前工作版本与已有 GitHub Release 的下一版本；同时更新 `src-tauri/pi-agent-desktop-package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 以及 `component-versions.json`。例如当前版本 0.7.7 且尚无本 Fork Release，第一次得到 0.7.8。**不要重复运行**，否则版本还会继续上升。
3. 检查生成的版本差异，并验证：
   ```bash
   npm run release:verify
   npm test
   npx tsc --noEmit
   npm run lint
   npm run drift
   git diff --check
   ```
   `release:verify` 会检查 Pi 与 pi-web 组件版本、人工锁定策略、清单一致性，以及本 Fork 不重复使用 Release 版本。若已有上游新版本而你暂不升级，必须先审查并显式维护 `scripts/release-component-pins.json`，不能静默忽略失败。
4. 将版本准备分支提交、推送为 PR，检查构建与回归后合入 `main`。确认当前主干是拟发布的提交；切勿在正式工作流运行过程中再次更新主干或触发第二次发布。

## 本地自用打包（不发布、不更新签名）

```bash
npm ci
npm run desktop:build
```

该命令先准备隔离的 Next.js standalone，再调用 Tauri 的 `tauri.local.conf.json` 覆盖 `createUpdaterArtifacts=false`。它生成本机架构的 `.app` / `.dmg` 等安装包，**不需要** Updater 私钥，不会生成可供自动升级的签名归档；且本地不注入 `PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY`，不注册生产 Updater。不要将此包上传为正式签名 Release。

Apple Silicon 产物通常在：

- `src-tauri/target/release/bundle/macos/Pi Agent.app`
- `src-tauri/target/release/bundle/dmg/Pi Agent_<版本>_aarch64.dmg`

不要在日常开发中额外执行 `npm run build` 污染 `.next/`；`desktop:build` 已经准备独立的构建目录。

## 正式发布（只在 main，手动触发）

```bash
gh workflow run release.yml --repo rontian/pi-agent-desktop --ref main
```

也可以到 GitHub **Actions → Publish signed desktop release → Run workflow**，填写本次发行说明（可选 Markdown）。现有工作流为 **手动触发**，依次构建 Apple Silicon DMG、Linux x64 DEB、Windows x64 NSIS；使用 Tauri 官方 `tauri-action` 上传安装包、签名、`latest.json`。Release 在构建阶段保持 Draft，**只有整个矩阵成功、组件清单上传后**才转为稳定 Latest。某个平台失败时，切勿手工发布缺少平台/Updater 资产的 Draft。

发布成功后检查：

```bash
gh release view v<版本> --repo rontian/pi-agent-desktop
```

应包含 `latest.json`、`component-versions.json`、macOS `.dmg`、Updater `.app.tar.gz` 与其 `.sig`，以及 Windows/Linux 相应产物。到设置页手动检查更新，确认来自 `rontian/pi-agent-desktop`，再在**已经安装本 Fork 正式签名上一版**的 Mac 上验证下载安装。首次本地包到正式包的转换要手动安装。

工作流发布后会尝试更新本仓库的 `Casks/pi-agent.rb` 版本和哈希。首次成功发布前 Cask 可能仍指向旧版本，不应作为安装源；如果你不使用 Homebrew，可忽略它，或在后续 PR 中单独关闭这个可选任务。

## 回滚与紧急情况

- 代码：修复后准备**更高版本号**重新发布，不能把旧版同号重新打成 Latest；Updater 依赖版本递增。
- 密钥：必须使用同一个 Tauri Updater 密钥对；私钥泄露时停止发布、轮换密钥并通过受控手动安装迁移。
- 平台打包失败：保留 Draft，不发布半成品；修复后检查该版本已有的 Draft/资产，避免重复同名 Release。
- 上游同步冲突：只在同步分支解决，保留 `docs/agents/fork-ui.md` 的本地交互契约与 fork ownership。不要重置 `main` 或放宽 drift 风险阈值来强行通过。

相关：`README.zh-CN.md`、`docs/desktop.zh-CN.md`、`docs/desktop-updates.md`、`docs/fork-sync.zh-CN.md`、`.github/workflows/release.yml`。
