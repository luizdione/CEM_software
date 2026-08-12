# Architecture

CEM is a **pnpm monorepo** written in TypeScript (ESM). It follows Clean Architecture: the domain
logic is isolated in framework‑agnostic packages, and the delivery mechanisms (CLI, Electron UI)
are thin adapters over that logic.

## Layers

```
        ┌───────────────────────────────────────────────┐
        │  apps/desktop (Electron+React)  apps/cli (cem) │  Delivery
        └───────────────┬───────────────────────┬───────┘
                        │ IPC                    │ direct calls
        ┌───────────────▼───────────────────────▼───────┐
        │  backup · restore · diagnostics · profiles     │  Use cases
        │  scanner · markdown · mcp · usage · sync        │
        └───────────────┬───────────────────────┬───────┘
                        │                        │
        ┌───────────────▼───────┐   ┌────────────▼───────┐
        │  core (domain model)  │   │  crypto (security) │  Domain / infra
        └───────────────┬───────┘   └────────────────────┘
                        │
                ┌───────▼───────┐
                │    shared     │  Primitives
                └───────────────┘
```

## Package dependency graph

| Package | Depends on | Responsibility |
| --- | --- | --- |
| `@cem/shared` | – | Result type, errors, logger, fs & format helpers |
| `@cem/core` | shared | Domain types, Claude Code locations, tokens, manifest, config |
| `@cem/crypto` | shared | AES‑256‑GCM, Argon2id, SHA‑256, Ed25519 |
| `@cem/scanner` | shared, core, crypto | Read‑only artifact discovery |
| `@cem/markdown` | shared, core | Token/line stats, references, overlap |
| `@cem/mcp` | shared, core | MCP discovery, normalization, redaction |
| `@cem/profiles` | shared, core | Profile CRUD, matching, templates |
| `@cem/diagnostics` | shared, core, scanner, mcp, markdown | Health checks, token rollups, fix remediation |
| `@cem/backup` | shared, core, crypto, scanner | `.cem` planning & writing |
| `@cem/restore` | shared, core, crypto | `.cem` reading, verification, restore |
| `@cem/usage` | shared, core | Temporal token-usage analytics from local transcripts |
| `@cem/server-inventory` | shared | Native machine inventory (host/GPU/conda/WSL/Docker) + threshold alerts |
| `@cem/sync` | shared, core | Optional, explicit Git sync of backups |

The graph is acyclic. Because dependencies only point "inward", any package can be extracted and
reused independently, and new modules can be added without modifying the core.

## Build & test tooling

- **Build:** [tsup](https://tsup.egoist.dev) per package (ESM + `.d.ts`), topologically ordered by
  pnpm. The CLI is bundled into a single self‑contained file. The desktop app is built by
  [electron‑vite](https://electron-vite.org).
- **Types:** a single root `tsconfig.json` with path aliases typechecks the whole repo without a
  prior build (`pnpm typecheck`).
- **Tests:** [Vitest](https://vitest.dev); package unit tests plus an end‑to‑end backup→restore
  integration test in `tests/`.
- **Quality:** ESLint (flat config) + Prettier.

## Desktop process model

```
┌────────────────────┐   contextBridge    ┌──────────────────────┐
│  Renderer (React)  │  window.cem.*      │  Preload (isolated)  │
│  no Node access    │ ─────────────────► │  ipcRenderer.invoke  │
└────────────────────┘                    └──────────┬───────────┘
                                                     │ IPC
                                          ┌──────────▼───────────┐
                                          │  Main process        │
                                          │  registers handlers  │
                                          │  → @cem/* packages    │
                                          └──────────────────────┘
```

The renderer runs with `contextIsolation: true` and `nodeIntegration: false`. It never imports Node
or `@cem/*` runtime code directly — only **types**. All privileged work happens in the main process
behind typed IPC channels (`src/shared/ipc.ts`).

## Data flow: a backup

1. `scanner` discovers artifacts (read‑only) → `ScannedArtifact[]`.
2. `backup` plans each artifact → archive path + portable restore target.
3. Each file is read, hashed (SHA‑256) and added to the archive; a manifest + checksums are built.
4. If a password is given, the payload is AES‑256‑GCM encrypted (Argon2id key).
5. A `.cem` (ZIP) file is written. Nothing on the source machine is modified.

See [`cem-format.md`](./cem-format.md) and [`backup-system.md`](./backup-system.md).
