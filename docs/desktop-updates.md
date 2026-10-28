# Desktop release updates — rontian Fork

本 Fork 的发行说明以 [独立发行手册](./fork-release.zh-CN.md) 为准。

- 发行及自动更新仓库：`rontian/pi-agent-desktop`，独立于原桌面上游 `abcwyc/pi-agent-desktop`。
- 代码来源：手动同步桌面上游、Pi SDK 与 pi-web；同步不会自动发布，避免未经审计覆盖定制。
- App 只检查本 Fork 的最新稳定 GitHub Release。Tauri Updater 仅接受本 Fork 私钥签名的安装包，首次安装正式签名版之前无法自动升级。
- `.github/workflows/component-updates.yml` 仅作为可选手动组件同步；原 GitHub Actions 的正式发布流程已经停用。正式 Release 只能由维护者在 Apple Silicon Mac 上本地生成签名更新包，再通过 gh 上传至本 Fork；确认所有 macOS 资产无误后才发布为 Latest。
- 本地 `npm run desktop:build` 使用 `src-tauri/tauri.local.conf.json` 关闭 Updater 产物生成，不需要签名密钥，不可作为自动升级发布包。
- Apple Developer ID 与公证独立于 Tauri updater 密钥。当前本地 macOS 发布默认使用 ad-hoc 签名；对外分发前需要额外配置。

首次密钥设置、版本递增、Actions Secrets、发布检查、失败恢复和上游同步的完整操作请直接阅读 [fork-release.zh-CN.md](./fork-release.zh-CN.md)。
