/**
 * @cem/server-inventory — read-only machine inventory for CEM.
 *
 * Natively collects host/CPU/disks, GPU (incl. the Windows "sysmem fallback"
 * VRAM metric), conda envs, WSL distros, Docker, installed programs, CLI tools
 * and config scripts, then derives threshold-based alerts. Ported from the
 * standalone `lupa_servidor` Python tool. Intended for the Electron main
 * process — the collectors run subprocesses and read the filesystem.
 */
export * from './types.js';
export * from './analyze.js';
export * from './backup-checklist.js';
export * from './collect/index.js';

import { readJson } from '@cem/shared';
import { analyzeInventory } from './analyze.js';
import type { Inventory } from './types.js';

/**
 * Load a previously exported `inventario.json` — produced by either this native
 * collector or the legacy Python tool — and re-derive its alerts for
 * consistency. Never trusts the file's stored `alertas`.
 */
export async function loadInventoryFromFile(path: string): Promise<Inventory> {
  const raw = await readJson<Inventory>(path);
  const alertas = analyzeInventory(raw);
  return { ...raw, alertas };
}
