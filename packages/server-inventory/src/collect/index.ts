/**
 * Orchestrates the per-section collectors into a full {@link Inventory}. Every
 * section runs concurrently and is individually guarded, so one failing probe
 * (a missing tool, a hung command) degrades to an error/unavailable shape for
 * that section without aborting the whole run — mirroring the Python collector's
 * per-section try/except in `main()`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isWindows } from './exec.js';
import { collectHost } from './host.js';
import { collectGpu } from './gpu.js';
import { collectPerformanceConfig } from './performance.js';
import { collectConda } from './conda.js';
import { collectWsl } from './wsl.js';
import { collectDocker } from './docker.js';
import { collectPrograms } from './programs.js';
import { collectTools } from './tools.js';
import { collectScripts } from './scripts.js';
import { analyzeInventory } from '../analyze.js';
import { buildBackupChecklist } from '../backup-checklist.js';
import type { Inventory, InventoryError, InventoryMeta, ScriptConfigEntry } from '../types.js';

export interface CollectOptions {
  /** Per-command timeout (ms). Individual collectors may override for slow probes. */
  readonly timeoutMs?: number;
  /** Directories scanned for config scripts. Defaults to {@link defaultScriptRoots}. */
  readonly scriptRoots?: readonly string[];
  /** Run the (slow) per-distro internal WSL inspection. Default false — like `--sem-wsl`. */
  readonly inspectWsl?: boolean;
  /** Measure conda env sizes on disk (slow). Default false — like `--sem-tamanho`. */
  readonly measureCondaSize?: boolean;
}

/** Default roots scanned for config scripts, mirroring the Python collector. */
export function defaultScriptRoots(): string[] {
  const home = homedir();
  const roots = [join(home, 'OneDrive', 'Data_Science', 'Projetos')];
  if (isWindows) roots.push('C:/github');
  roots.push(join(home, '.claude'));
  return roots;
}

async function safely<T>(label: string, fn: () => Promise<T>): Promise<T | InventoryError> {
  try {
    return await fn();
  } catch (e) {
    return { erro: `${label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function safelyArray<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

/**
 * Collect the full machine inventory natively. This runs external tools
 * (nvidia-smi, powershell/WMI, wsl, docker) and reads the filesystem — it is
 * meant for the Electron main process, never the renderer.
 */
export async function collectInventory(options: CollectOptions = {}): Promise<Inventory> {
  const roots = options.scriptRoots ?? defaultScriptRoots();
  const opts = { timeoutMs: options.timeoutMs };

  const [host, gpu, config_desempenho, conda, wsl, docker, programas, ferramentas] = await Promise.all([
    safely('host', () => collectHost(opts)),
    safely('gpu', () => collectGpu(opts)),
    safely('config_desempenho', () => collectPerformanceConfig(opts)),
    safely('conda', () => collectConda({ measureSize: options.measureCondaSize ?? false })),
    safely('wsl', () => collectWsl({ inspect: options.inspectWsl, timeoutMs: options.timeoutMs })),
    safely('docker', () => collectDocker(opts)),
    safely('programas', () => collectPrograms(opts)),
    safely('ferramentas', () => collectTools(opts)),
  ]);
  const scripts_config: ScriptConfigEntry[] = await safelyArray(() => collectScripts(roots));

  const meta: InventoryMeta = {
    gerado_em: new Date().toISOString(),
    versao_coletor: '1.0-ts',
    raizes_scripts: roots,
    wsl_inspecionado: options.inspectWsl ?? false,
  };

  const partial = {
    meta,
    host,
    gpu,
    config_desempenho,
    conda,
    wsl,
    docker,
    programas,
    ferramentas,
    scripts_config,
  };
  const alertas = analyzeInventory(partial);
  const backup = buildBackupChecklist(partial);
  return { ...partial, alertas, backup };
}
