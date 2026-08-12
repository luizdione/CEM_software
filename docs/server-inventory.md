# Server Inventory

Since **1.4.0**, CEM can inventory the **whole machine**, not just your Claude Code environment.
The **Server Inventory** section produces a read‑only snapshot of the host, GPU, Python/conda
environments, WSL, Docker, installed software and configuration scripts, and derives
threshold‑based **alerts** plus a **backup‑readiness checklist**.

It is a native TypeScript port of the standalone **`lupa_servidor`** tool. It is **read‑only**: it
never changes a setting, kills a process or runs a repair. The remediation actions of the original
tool were intentionally **not** ported — CEM already has its own opt‑in remediation engine
(`@cem/diagnostics`, the *Solve problems* flow).

## Data source (read‑only, native, local)

The inventory is collected by the Electron **main** process (Node) — never the renderer and never a
bundled Python runtime. Each section re‑orchestrates the same OS tools the original tool used:

| Section | How it is collected |
| --- | --- |
| Host / CPU / disks / RAM | `Get-CimInstance` (WMI) on Windows; `node:os` as a cross‑platform fallback |
| GPU | `nvidia-smi` (query + `-q -d PERFORMANCE`), plus Windows performance counters for *sysmem fallback* |
| Performance config | `powercfg`, registry reads (HAGS / TDR / VBS), pagefile, antivirus, env vars |
| conda | reads `conda-meta/*.json` and `site-packages/*.dist-info` **straight off disk** — never invokes `conda` |
| WSL | `wsl -l -v` / `wsl --version` (UTF‑16LE‑decoded); optional per‑distro inspection |
| Docker | `docker version` / `info` / `images` / `ps -a` / `volume ls` |
| Programs | `Uninstall` registry keys (never `Win32_Product`, which would trigger MSI repair) |
| CLI tools | `Get-Command` + a version probe for ~26 known tools |
| Config scripts | on‑disk scan of a few roots for `.ps1/.bat/.sh/.yml/.env/…` |

Every probe **times out** and **never throws**: if a tool is missing or a command hangs, that
section degrades to an "unavailable" shape instead of aborting the whole run. Windows‑only probes
are skipped on macOS/Linux. Nothing is sent anywhere and nothing is modified.

## What it shows

Eight tabs mirror the collected sections:

- **Overview** — key stats (VRAM %, GPU util, RAM %, sysmem fallback / conda env count), the full
  alert list, and disk usage.
- **GPU & CPU** — per‑GPU metrics (VRAM, clocks, power, temperature, throttle reasons), the CPU, and
  a **GPU‑memory‑per‑process** table that highlights processes whose VRAM has spilled into system RAM.
- **Environments** — conda environments (Python version, package counts, `torch` / CUDA build).
- **WSL** — distros, versions, VHDX size, `.wslconfig`.
- **Docker** — client/server version, NVIDIA runtime, images / containers / volumes.
- **Software** — detected CLI tools and installed programs.
- **Scripts** — configuration scripts that touch CPU/GPU/environment.
- **Backup** — a readiness checklist (conda exports, WSL, Docker, free space, …).

### The "sysmem fallback" metric

Under Windows' WDDM driver model, when a process needs more VRAM than the GPU has, the driver
silently **spills** the overflow into system RAM over PCIe. This is far slower than real VRAM, and
`nvidia-smi` does **not** expose it. CEM reads the Windows performance counters
`\GPU Process Memory(*)\Local Usage` (real VRAM) and `\...\Non Local Usage` (spilled to RAM),
joins them per process, and reports both `sysmem_fallback_gb` (total spilled) and a per‑process
split — so an invisible performance cliff becomes visible.

## Alerts

A pure analyzer (`analyzeInventory`) derives alerts from the raw data using fixed thresholds, e.g.:

- **GPU** — VRAM ≥ 92 % (critical); temperature ≥ 80 °C; SM clock < 75 % of max; PCIe below max gen;
  active throttle; sysmem fallback ≥ 0.5 GB (critical, with the top offending processes).
- **System** — RAM > 85 %; any disk > 90 %; HAGS off/indeterminate; high‑performance power plan off;
  VBS active.
- **Environment** — `torch` CPU‑only build; `torch` CUDA build newer than the driver supports
  (critical).
- **WSL / Docker** — missing `.wslconfig`; GPU not visible inside a distro; NVIDIA Docker runtime
  present (ok) or absent.

Alerts are sorted by severity (`critico` < `aviso` < `info` < `ok`). The `reparo` field from the
original tool is preserved in the schema for fidelity but is **wired to nothing** — this section
never acts on the machine.

## Using it

- **Collect now** runs a fresh collection. It can take **~30–60 s** (GPU performance counters, the
  registry sweep and, if enabled, per‑distro WSL inspection are the slow parts), so it only runs
  when you ask — never automatically on tab open. The result is cached under the CEM data dir
  (`<cemDataDir>/server-inventory/latest.json`) and shown immediately next time.
- **Load file…** imports a previously exported `inventario.json` — produced by either this native
  collector or the legacy Python `lupa_servidor`. Alerts are always **re‑derived** on load, so a
  stale `alertas` field in the file is ignored.

## Schema & package

The data contract keeps the original tool's **Portuguese `snake_case`** keys
(`host`, `gpu`, `conda`, `sysmem_fallback_gb`, `alertas`, …) so a single `inventario.json` works as
both a golden test fixture and an interchange format between the TS and legacy Python collectors.
Only the UI renders English labels.

The logic lives in the framework‑agnostic **`@cem/server-inventory`** package:

- `collectInventory(options?)` — collect the full inventory (main process only).
- `analyzeInventory(inventory)` — derive alerts from raw sections (pure, no I/O).
- `loadInventoryFromFile(path)` — load + re‑analyze an exported `inventario.json`.

See [`docs/architecture.md`](./architecture.md) for how it fits into the monorepo.
