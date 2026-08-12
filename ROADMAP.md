# Roadmap

CEM follows [Semantic Versioning](https://semver.org). This roadmap is indicative and community
input is welcome — open a discussion or issue to propose changes.

## ✅ 1.0.0 — Foundation (current)

- Monorepo, core packages, crypto, scanner, markdown, MCP, profiles, diagnostics.
- `.cem` backup format with checksums and AES‑256‑GCM encryption.
- CLI with the full command set.
- Desktop app (Electron + React) with all primary views.
- Documentation, CI, tests.

## 🔜 1.1 — Quality of life

- Incremental / diff‑based backups (store only what changed since the last `.cem`).
- Backup registry and history view in the desktop app.
- Drag‑and‑drop `.cem` import.
- Richer profile editor (visual selection rules, live preview of matched artifacts).
- More granular restore (per‑file selection tree).

## 🔭 1.2 — Sync (opt‑in, never automatic)

- ✅ **Git/GitHub sync shipped** (`@cem/sync`, `cem sync`, desktop Sync view) — explicit push/pull
  only, no background uploads, no credential handling. See [`docs/sync.md`](./docs/sync.md).
- Additional providers behind the same `SyncProvider` shape: Google Drive, OneDrive, Dropbox, NAS,
  local server.
- Signed archives (Ed25519) with verify‑on‑import.

## 🧩 1.3 — Plugins & extensibility

- Formal plugin manager (list, inspect, export/import plugin bundles).
- Public extension API so third‑party modules can add scanners, exporters and views.
- Community profile & skill templates gallery.

## 🖥️ 1.4 — Server Inventory (shipped)

- ✅ **Server Inventory shipped** (`@cem/server-inventory`, desktop *Server Inventory* view) — a
  read‑only inventory of the whole machine (host/CPU/disks/RAM, NVIDIA GPU, conda, WSL, Docker,
  installed programs, CLI tools, config scripts) with threshold‑based alerts and a backup‑readiness
  checklist. Collected natively from the Electron main process (no Python runtime). See
  [`docs/server-inventory.md`](./docs/server-inventory.md).
- Includes the Windows **"sysmem fallback"** GPU‑memory metric (VRAM spilled into system RAM over
  PCIe) that `nvidia-smi` does not expose.
- Ported from the standalone `lupa_servidor` tool; **read‑only** — no remediation actions were
  ported (CEM keeps its own `@cem/diagnostics` remediation engine).

## 🧪 Ongoing

- Broader test coverage (UI, performance, migration matrices).
- Localization (starting with English and Portuguese).
- Accessibility polish.

> ✅ Auto‑update with pre‑update backup and a documented rollback path shipped in 1.0.0
> (see [`docs/updates.md`](./docs/updates.md)).

## ❌ Explicit non‑goals

CEM will **never** modify Claude Code binaries, intercept traffic, reverse‑engineer Anthropic
products, or bypass authentication/licensing/usage limits. Any feature request in that direction is
out of scope.
