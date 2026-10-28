# Pi Agent

**English** | [简体中文](./README.zh-CN.md)

This is the independently maintained **rontian Fork**. Its releases and updater are separate from the desktop upstream; see [Fork release manual](./docs/fork-release.zh-CN.md).

`pi-agent-desktop` is a local AI agent desktop app for macOS and Windows. It packages the agent capabilities of [pi](https://github.com/earendil-works/pi) into a standalone, installable application.

## Features

- Browse and resume past Pi sessions by project, without digging through terminal history or `.jsonl` files.
- Talk to the agent in real time inside a desktop window, with thinking, tool calls, context usage, cost, and compaction state all visible.
- Continue from any earlier message as a branch, or fork the conversation into an independent session.
- Manage models, OAuth/API keys, custom model configuration, skills, and plugins.
- Switch Git worktrees from the sidebar and browse project files.
- Scheduled tasks: run a saved prompt in a new session on a schedule (hourly, daily, weekly, a custom cron expression, or once). They run while the app is open, even with its window hidden, default to read-only tools, catch up once after a sleep, and notify you when a run succeeds or fails.
- Preview source code, diffs, Markdown, images, audio, PDF, and DOCX files.
- Dark mode, automatic session naming, a completion sound, and restored run state.
- A weekly check of the latest stable `pi-agent-desktop` GitHub Release, with an in-app notice only when the installed app is older.
- One upgrade button installs a complete, signed new build of Pi Agent and restarts automatically.

![Pi Agent light mode](./docs/screenshots/pi-agent-light.webp)

![Pi Agent dark mode](./docs/screenshots/pi-agent-dark.webp)

**[⬇️ Download this Fork (Apple Silicon macOS)](https://github.com/rontian/pi-agent-desktop/releases)**

Repository: [rontian/pi-agent-desktop](https://github.com/rontian/pi-agent-desktop)

## Installation And Usage

### Install The Desktop App

This Fork's **locally published Apple Silicon builds** are available from [GitHub Releases](https://github.com/rontian/pi-agent-desktop/releases) after the first release:

- Apple Silicon Mac: download the `aarch64.dmg`, open it, and drag the app into `Applications`. Official releases do not build for Intel Macs.
- Apple Silicon Mac with [Homebrew](https://brew.sh): install from this repository's tap. The tap is added from the repo URL, so the first command is needed once:

  ```bash
  brew tap rontian/pi-agent-desktop https://github.com/rontian/pi-agent-desktop
  brew install --cask pi-agent
  ```

  The app upgrades itself from Settings, so `brew upgrade` leaves it alone unless you pass `--greedy`. `brew uninstall --cask --zap pi-agent` removes the app and its window state but never `~/.pi`, which the pi CLI shares.
- Linux x64: not published by this Fork; upstream packages do not include the Fork customizations.

- Windows x64: not published by this Fork; upstream packages do not include the Fork customizations.

This Fork's published installers currently target Apple Silicon Macs on macOS 11 or later. The upstream sources also support Windows and Linux, but this Fork does not publish their installers. The desktop package bundles the Next.js server, the Node.js runtime, and the current Pi SDK, so the local server starts with the app — no separate terminal, Node.js installation, or manually started web server is required.

> Installing Pi Agent gives you the agent inside the app, but it does not install a global `pi` command. If you also want the Pi CLI in your terminal, install it separately by following the [pi project](https://github.com/earendil-works/pi) instructions.

> **macOS blocks the first launch**: the macOS build is not yet signed with an Apple Developer ID or notarized, so Gatekeeper may say the developer cannot be verified or that the app "is damaged and can't be opened" (Homebrew installs included). Click "Open Anyway" in System Settings › Privacy & Security, or run:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/Pi Agent.app"
> ```

Before signed auto-updates can be used for the first time, an older build without the updater has to be replaced by manually installing a signed one. Upgrades then happen from Settings.

### Use Existing Pi Data

Pi Agent reads Pi's local data directory by default:

```text
~/.pi/agent/
```

Sessions normally live under:

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

If you have used Pi on this machine before, the app picks up your existing sessions, models, and authentication after installation. Set `PI_CODING_AGENT_DIR` to point at a different Pi agent data directory.

Model keys and session data stay on your machine. The file-browsing API only allows access to the current session, the selected project, and explicitly authorized working directories.

## Update Checks And Upgrades

The installed Fork checks **only the latest stable `rontian/pi-agent-desktop` Release** (at most once a week). New versions of `abcwyc/pi-agent-desktop`, `earendil-works/pi` or `agegr/pi-web` are upstream inputs, **not** automatic installation sources. The maintainer reviews and syncs them manually, then publishes an independently versioned complete installer. Tauri verifies its updater signature using this Fork's own key.

A local `npm run desktop:build` produces unsigned-updater test installers; to enable in-app upgrades install a signed Fork Release once. See [Fork release manual](./docs/fork-release.zh-CN.md).

## HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables. For example, when starting the dev server from a terminal:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npm run dev
```

## Local Development

### Requirements

- macOS 11+ (Apple Silicon), Windows 10/11 x64, or Linux x64 with WebKitGTK 4.1 and GTK 3
- Node.js 22 (recommended)
- npm
- Rust 1.85+
- macOS: Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools and WebView2
- Linux: GTK/WebKitGTK development packages

### Start The Web Dev Server

```bash
npm install
npm run dev
```

The dev server runs at [http://localhost:30141](http://localhost:30141) and does not open a browser. `npm run web` starts the same loopback server and opens `http://127.0.0.1:30141` in the desktop browser after it is ready. From WSL that is the Windows browser. See [Web profile](./docs/web-profile.md).

Do not run `next build` or `npm run build` during normal development. They write into `.next/` and can disrupt a running dev server; production builds are done by the desktop preparation script or by CI.

### Network Exposure (LAN)

`npm run dev` and `npm start` listen on `127.0.0.1` only. `npm run dev:lan`, `npm run start:lan` and `pi-web -H 0.0.0.0` listen on every interface. Pi Agent can run shell commands (the terminal tab and the agent's own tools) and read files as you, so **anyone who can reach the port gets the same access**. Before using a LAN mode, set a password:

```bash
PI_WEB_PASSWORD='choose-a-long-passphrase' npm run dev:lan
```

With `PI_WEB_PASSWORD` set, the browser asks for it on first visit and failed attempts are throttled. The connection is still plain HTTP, so put it behind HTTPS or a trusted VPN, and use `PI_WEB_ALLOWED_HOSTS` (comma-separated) to allow a DNS name other than an IP address. Without a password the launcher refuses to listen beyond loopback; on a network you trust, `PI_WEB_ALLOW_UNAUTHENTICATED=1` starts it anyway with a warning. The packaged desktop app is unaffected: it binds to loopback and authenticates the WebView with a per-process token.

### Start Desktop Dev Mode

```bash
npm run desktop:dev
```

This starts the existing Next.js dev server and opens it in a native Tauri window, without producing an installer.

### Common Checks

```bash
# Node tests (identical to the CI sync gate, including components/ tests)
npm test

# TypeScript
node_modules/.bin/tsc --noEmit

# ESLint and the branding protection test
npm run lint

# Divergence from pi-web upstream, split into "styling" and "structural" changes
npm run drift

# Rust/Tauri
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# Verify the bundled components match the latest stable releases
npm run release:verify
```

`release:verify` reaches GitHub and requires the bundled `pi` and `pi-web` to match their latest stable releases exactly, while also checking the component manifest against the actual dependencies.

## Desktop Packaging

```bash
npm run desktop:build
```

The desktop build:

1. Generates the Next.js standalone server in an isolated directory.
2. Bundles the Node.js runtime for the current architecture.
3. Places the server and runtime into the app as Tauri resources.
4. Produces local `.app` and `.dmg` on Apple Silicon Macs, NSIS `-setup.exe` on Windows x64, or `.deb` on Linux x64, without requiring an updater signing key.

On Linux, the package requires a WebKitGTK 4.1 runtime and GTK 3. It includes the Node.js runtime, so users do not need to install Node.js separately.

Unsigned-updater local builds do not register the production updater. For this Fork, sign releases **locally** with `npm run release:build:mac` and publish assets using `npm run release:publish:mac` (gh), never GitHub Actions.

## Upstream Sync And Releases

- [`component-updates.yml`](./.github/workflows/component-updates.yml) remains optional/manual-only and syncs Pi SDK / pi-web with the Fork ownership boundary gate. Desktop upstream code is integrated separately via PR using [fork-sync.zh-CN.md](./docs/fork-sync.zh-CN.md).
- [`release.yml`](./.github/workflows/release.yml) is disabled. Releases are built and signed locally on Apple Silicon macOS: `npm run release:build:mac`, then `npm run release:publish:mac` uses `gh` to upload validated assets. No GitHub Actions build or publish occurs.
- `npm run release:prepare` keeps unpublished versions unchanged and advances only when the current version already has a Fork Release. `npm run release:check` runs the full local check suite. Tags use `rontian-v<version>` and never overwrite upstream tags. It also refreshes the component manifest. `npm run desktop:build` produces local installers without updater signing.

For one-time keys, versioning, local builds, publish verification and safe recovery, use the [independent Fork release manual](./docs/fork-release.zh-CN.md). This is **not** the `npm run release` flow for upstream's npm package.

## Project Structure

```text
app/
  api/                  Next.js APIs: agent, sessions, models, files, update checks
components/             Pages, chat, sidebar, settings, and version notices
hooks/                  Client state: session streams, audio, drag and drop, theme
lib/                    AgentSession, HTTP proxy, session reading, file security, upgrade logic
scripts/                Desktop packaging, component version sync, release verification
src-tauri/
  capabilities/         Tauri permission configuration
  resources/            Desktop resources and the component version manifest
  src/                  Desktop window, local server, and updater registration
.github/workflows/      Daily component sync and desktop release automation
instrumentation.ts     Next.js server-side HTTP proxy initialization
```

## Related Documents

- [Ownership boundaries](./docs/ownership-boundaries.md) — the split with `pi-web` upstream, the rules for editing shared files, and how the automated sync decides
- [Desktop updates and releases](./docs/desktop-updates.md)
- [Git worktrees](./docs/worktrees.md)
- [Pi session and project architecture](./AGENTS.md)

## Credits And License

The desktop integration of Pi Agent is provided by `pi-agent-desktop`; the core capabilities and the web interface come from [earendil-works/pi](https://github.com/earendil-works/pi) and [agegr/pi-web](https://github.com/agegr/pi-web) respectively. Thanks to those projects and their contributors.

Code in the root of this repository is under the MIT License in [`LICENSE`](./LICENSE). The code and dependencies of the three component projects remain subject to the licenses of their own repositories; keep the corresponding copyright and license notices when copying, modifying, or redistributing.
