import { BrowserWindow, dialog } from 'electron';
import { dirname, join } from 'node:path';
import { getCemDataDir } from '@cem/core';
import { pathExists, readJson, writeJson, ensureDir } from '@cem/shared';
import { collectInventory, loadInventoryFromFile } from '@cem/server-inventory';
import type { CollectOptions, Inventory } from '@cem/server-inventory';

function cachePath(): string {
  return join(getCemDataDir(), 'server-inventory', 'latest.json');
}

/** Load the last collected inventory from the on-disk cache, if any. */
export async function loadCachedInventory(): Promise<Inventory | null> {
  const path = cachePath();
  if (!(await pathExists(path))) return null;
  try {
    return await readJson<Inventory>(path);
  } catch {
    return null;
  }
}

/** Collect a fresh inventory and persist it as the new cache. */
export async function runCollectInventory(options: CollectOptions = {}): Promise<Inventory> {
  const inventory = await collectInventory(options);
  const path = cachePath();
  await ensureDir(dirname(path));
  await writeJson(path, inventory).catch(() => undefined);
  return inventory;
}

/** Prompt the user for a previously exported inventory JSON and load it. */
export async function pickAndLoadInventoryFile(): Promise<{
  ok: boolean;
  inventory?: Inventory;
  reason?: string;
}> {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'Inventory JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, reason: 'cancelled' };
  try {
    const inventory = await loadInventoryFromFile(res.filePaths[0]);
    return { ok: true, inventory };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'load-failed' };
  }
}
