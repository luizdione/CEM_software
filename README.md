<div align="center">

# Claude Environment Manager (CEM)

**Backup, restore, manage and migrate your Claude Code environment — safely and locally.**

[![CI](https://github.com/luizdione/CEM_software/actions/workflows/ci.yml/badge.svg)](https://github.com/luizdione/CEM_software/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Semantic Versioning](https://img.shields.io/badge/semver-1.4.0-green.svg)](https://semver.org)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

</div>

> **Compliance first.** CEM does **not** modify, patch, reverse‑engineer or intercept Claude Code
> or any Anthropic software. It only reads and writes **your own local files** in documented
> locations, uses public/supported mechanisms, and fully respects the
> [Anthropic Terms of Use](https://www.anthropic.com/legal/consumer-terms).

---

## 🇧🇷 Resumo (Português)

O **Claude Environment Manager (CEM)** é um aplicativo desktop + CLI para **backup, restauração,
gerenciamento e migração** completa do seu ambiente do Claude Code. Ele localiza automaticamente
suas configurações, skills, agentes, MCPs, arquivos `CLAUDE.md`, prompts e templates **apenas em
arquivos locais documentados**, e permite empacotá‑los em um arquivo `.cem` (ZIP com manifesto,
checksums e criptografia opcional AES‑256) para reinstalar tudo em outro computador com poucos
cliques. O CEM **nunca** modifica binários da Anthropic, nem burla limites, autenticação ou APIs
privadas.

A partir da **1.4.0**, o CEM inclui também a seção **Server Inventory**: um inventário
**somente‑leitura** da máquina inteira — CPU/discos/RAM, GPU NVIDIA (incluindo a métrica de
*sysmem fallback*, a VRAM que transbordou para a RAM e é invisível ao `nvidia‑smi`), ambientes
conda, distros WSL, Docker, programas instalados e scripts de configuração — com alertas de
gargalo e um checklist de prontidão para backup.

---

## What is CEM?

Claude Code stores your configuration, memory, skills, subagents, slash‑commands, MCP servers and
project settings across a handful of documented local files (`~/.claude/`, `~/.claude.json`,
project `CLAUDE.md` / `.mcp.json`, …). When you move to a new machine, reproducing that setup by
hand is tedious and error‑prone.

**CEM** discovers all of those artifacts, lets you inspect and organize them, and packages them into
a single portable, verifiable, optionally‑encrypted `.cem` file. On the new machine you install
Claude Code, install CEM, import the `.cem`, and your environment is back.

## ✨ Features

| Area | What it does |
| --- | --- |
| **Dashboard** | Environment state, integrity, counts (skills / agents / MCP / profiles), footprint, alerts |
| **Smart Scanner** | Read‑only discovery of every Claude Code artifact across documented locations + deep sweep of `~/.claude` |
| **MCP Manager** | Lists MCP servers from `~/.claude.json`, `settings.json`, `.mcp.json`, `claude_desktop_config.json`; masks secrets |
| **Skills / Agents / Markdown** | Inspect skills (description, author, version, dependencies, tokens) and agents (model, tools, enabled state) via front‑matter parsing; browse `CLAUDE.md`‑style docs |
| **Token Analyzer** | Tokens per file/category, large‑file detection, content‑overlap (redundancy) detection, waste report |
| **Token Usage (temporal)** | Real consumption over **24h / 3d / 7d / 30d** per session & project from local transcripts: context‑window reading vs cache building vs output; main session vs workflow agents; git/GitHub activity; skill/agent launches — with statistical improvement proposals (branch heavy sessions, shrink heavy `CLAUDE.md`/skills, batch pushes) |
| **Profiles** | Activate a subset of config/docs per workflow (Development, Research, Bioinformatics, Python, Next.js, Docker, …) |
| **Diagnostics** | Orphan references, broken MCP configs, duplicates, token bloat |
| **Server Inventory** | Read‑only machine inventory: host/CPU/disks/RAM, NVIDIA GPU (VRAM, clocks, power, temp, throttle) with the Windows **"sysmem fallback"** metric invisible to `nvidia-smi`, conda envs, WSL, Docker, installed programs, CLI tools and config scripts — with threshold alerts and a backup‑readiness checklist |
| **Solve problems** | One click proposes the best fix per finding; you **accept or ignore** each — with automatic backups and audit logging (`cem fix`) |
| **Backup / Restore** | Create and restore `.cem` archives with checksums, integrity verification and selective restore |
| **Encryption** | AES‑256‑GCM payload encryption with Argon2id key derivation + Ed25519 signing primitives |
| **History & Logs** | Local backup registry (populates "last backup") and an append‑only audit log of operations |
| **CLI** | `cem scan | doctor | fix | backup | restore | verify | export | import | profiles | skills | agents | tokens | usage | mcp | history | sync` |

## 📸 Screenshots

> Screenshots are being prepared. Run `pnpm dev:desktop` to explore the app: Dashboard with the
> per‑project token‑usage chart, the Token Usage tab (24h/3d/7d/30d), Diagnostics with
> **Solve problems**, the **Server Inventory** tab (GPU/CPU, conda, WSL, Docker, alerts),
> MCP/Skills/Agents managers, Backup/Restore and Sync.

## 🧭 Objectives

- Reinstall a complete Claude Code environment on a new computer **in a few clicks**.
- Keep everything **local, transparent and reversible** — nothing is deleted automatically.
- Be a **good citizen**: only documented files, public APIs, supported commands and MCPs.
- Provide a **modular, open‑source** codebase where each component works independently.

## 🚀 Installation

### From a release (recommended — no command line needed)

Download from the [Releases page](https://github.com/luizdione/CEM_software/releases):

- **Windows 10/11 (x64)** — `install_CEM-x.y.z.exe`: assisted installer where you **choose the
  install directory**; it creates a **desktop icon** and a Start Menu entry (to pin to the taskbar,
  right‑click the Start Menu entry → *Pin to taskbar* — Windows does not allow installers to pin
  automatically).
- **macOS 12+** — `Claude Environment Manager-x.y.z-<arch>.dmg`. *(There is no iOS/iPadOS version:
  Electron desktop apps cannot run on iOS.)*
- **Linux** — one‑line command‑line install (downloads the latest AppImage and registers a desktop
  entry, no root needed):

  ```bash
  curl -fsSL https://raw.githubusercontent.com/luizdione/CEM_software/main/scripts/install-linux.sh | bash
  ```

  `.deb` packages are also attached to each release.

### From source (for developers)

> 📋 **Requirements:** Node.js ≥ 20 and pnpm ≥ 9

#### 1. Clone and enter the repository
```bash
git clone https://github.com/luizdione/CEM_software.git
cd CEM
```

#### 2. Configure build scripts permissions (Crucial for pnpm v10+)
pnpm v10+ ignores third-party build scripts by default. You **must** approve `electron` and `esbuild` before installing, otherwise the binaries and bundlers will not download.
```bash
pnpm approve-builds electron esbuild
```

#### 3. Install dependencies and build the monorepo
```bash
pnpm install
pnpm build
```

#### 4. Run the application
To test the **CLI**:
```bash
node apps/cli/dist/index.js --help
```

To launch the **Desktop App** in development mode:
```bash
pnpm dev:desktop
```

### Install the CLI globally

If you want to use the `cem` command anywhere on your machine, build and install it globally:

```bash
pnpm build:cli
npm i -g ./apps/cli
cem --help
```

## 📋 Requirements

- **Node.js ≥ 20** and **pnpm ≥ 9** (for building from source)
- Claude Code installed locally (CEM reads its documented files; it does not require Claude Code to run)
- OS: Windows 10+, macOS 12+, or a modern Linux distribution

## 💻 Usage examples

```bash
# See what CEM finds (read-only)
cem scan

# Full health check
cem doctor

# Create an encrypted backup
CEM_PASSWORD='correct horse battery staple' cem backup --encrypt

# Inspect an archive without restoring
cem verify ~/CEM\ Backups/cem-backup-2025-01-31_14-05-09.cem

# Restore onto a new machine (dry run first)
cem restore backup.cem --dry-run
cem restore backup.cem --yes

# Restore only skills and agents
cem restore backup.cem --kinds skill,agent

# Analyze token usage / find redundant docs
cem tokens

# Create a profile from a template and back up only its artifacts
cem profiles create "My Python" --from-template Python
cem backup --profile "My Python"
```

## 🏗️ Architecture

CEM is a **pnpm monorepo** built with TypeScript. The domain logic lives in framework‑agnostic
packages that are consumed by both the CLI and the desktop app.

```
CEM/
├── apps/
│   ├── desktop/     # Electron + React UI (electron-vite)
│   ├── cli/         # `cem` command (commander)
│   └── installer/   # packaging config & notes
├── packages/
│   ├── shared/      # Result type, errors, logger, fs & format helpers
│   ├── core/        # domain model, Claude Code locations, tokens, .cem manifest, config
│   ├── crypto/      # AES-256-GCM, Argon2id, SHA-256, Ed25519
│   ├── scanner/     # read-only artifact discovery
│   ├── markdown/    # token/line stats, references, overlap detection
│   ├── mcp/         # MCP discovery, normalization, redaction
│   ├── profiles/    # profile CRUD, matching, templates
│   ├── diagnostics/ # health checks, token rollups + fix remediation
│   ├── usage/       # temporal token-usage analytics (local transcripts)
│   ├── server-inventory/ # native machine inventory (host/GPU/conda/WSL/Docker) + alerts
│   ├── sync/        # optional, explicit Git sync of backups
│   ├── backup/      # .cem planner & writer
│   └── restore/     # read, verify, restore
├── docs/            # architecture, API, .cem format, flows, manuals
├── examples/        # a sample Claude environment to try CEM on
├── scripts/         # helper scripts
└── tests/           # integration tests
```

Read more in [`docs/architecture.md`](./docs/architecture.md) and the
[`.cem` format spec](./docs/cem-format.md).

### Design principles

SOLID · DRY · KISS · Clean Architecture · Clean Code. Every package is independent, has a single
responsibility and can be reused on its own. New modules can be added without touching the core.

## ❓ FAQ

**Does CEM modify Claude Code?**
No. CEM never writes to Claude Code binaries or Anthropic code, never intercepts traffic, never
touches authentication or usage limits. It reads documented local files and writes `.cem` archives
and (on restore) your own config files.

**Is my data sent anywhere?**
No. CEM has **zero telemetry**. Everything stays on your machine unless *you* export a `.cem` file
or configure an optional sync target.

**Are my secrets safe in a backup?**
MCP environment values and other sensitive fields live inside the archive payload, which you can
encrypt with AES‑256‑GCM (Argon2id‑derived key). The manifest never stores your password.

**Is the token count exact?**
No — it is a fast heuristic for *relative* comparison. CEM does not call any Anthropic tokenizer or
API.

See [`docs/faq.md`](./docs/faq.md) for more.

## 🛠️ Troubleshooting (Resolução de Problemas)

### `pnpm dev:desktop` fails with "Error: Electron uninstall" or Esbuild errors
If you are using **pnpm v10 or higher**, `electron-vite` cannot find the Electron binary or `esbuild` scripts fail to run, showing errors like `Error: Electron uninstall`.

**Solution:**
Approve the build scripts and force reinstall:
```bash
pnpm approve-builds electron esbuild
pnpm install --force
pnpm dev:desktop
```

### `pnpm` or `cem` command not recognized in Windows PowerShell
If `pnpm` is not recognized, install it globally: `npm install -g pnpm`.
If `cem` command fails, ensure your global npm prefix path (usually `AppData\Roaming\npm`) is added to your Windows `PATH` environment variable.

## 🗺️ Roadmap

See [`ROADMAP.md`](./ROADMAP.md). Highlights: optional Git/cloud sync, richer plugin management,
diff‑based incremental backups, and signed archive distribution.

## 🤝 Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and our
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Security issues: see [`SECURITY.md`](./SECURITY.md).

## 📄 License

[MIT](./LICENSE) © Luiz Dione and CEM Contributors.
