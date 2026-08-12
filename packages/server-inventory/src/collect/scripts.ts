/**
 * Native port of `coletar_scripts()` from coletar_inventario.py. Recursively
 * scans a set of root directories for config scripts that touch CPU/GPU/env
 * settings — pure filesystem walk, no subprocess involved.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ScriptConfigEntry } from '../types.js';
import { round } from './exec.js';

// PADROES_SCRIPT in coletar_inventario.py — order mirrored so the per-root cap
// (see MAX_PER_ROOT) fills up in the same priority order as the Python original.
const SCRIPT_EXTENSIONS = ['.ps1', '.bat', '.cmd', '.sh', '.yml', '.yaml', '.env', '.cfg'] as const;

// Directory names pruned during the walk (case-insensitive). Safe optimization: any
// file under one of these always fails IGNORE_PATH_RE below, so skipping the whole
// subtree cannot change the result set, only the time it takes to produce it.
const IGNORED_DIR_NAMES = new Set(
  [
    '.git', 'node_modules', 'site-packages', '__pycache__', '.venv', 'venv', 'envs',
    'pkgs', 'conda-meta', '.cache', 'Library', 'AppData', 'OBSOLETOS',
  ].map((s) => s.toLowerCase()),
);

// Authoritative ignore check, path-segment bounded — mirrors the Python `ignorar` regex exactly.
const IGNORE_PATH_RE =
  /[\\/](\.git|node_modules|site-packages|__pycache__|\.venv|venv|envs|pkgs|conda-meta|\.cache|Library|AppData|OBSOLETOS)[\\/]/i;

// PALAVRAS_SCRIPT_CONFIG in coletar_inventario.py.
const CONFIG_MARKER_RE =
  /cuda|nvidia|gpu|nvidia-smi|torch\.cuda|device\s*=|OMP_NUM_THREADS|MKL_NUM_THREADS|n_?jobs|nproc|threads|--gpus|CUDA_VISIBLE_DEVICES|PYTORCH_CUDA_ALLOC_CONF|powercfg|affinity|taskset|conda\s+(?:create|env|activate)|docker\s+run|pip\s+install|apt-get\s+install|mamba\s+(?:create|install)/gi;

// Used against the FULL marker set (not the truncated 12), mirrors Python's `" ".join(marcas)` check.
const GPU_HINT_RE = /cuda|nvidia|gpu|--gpus/i;

const MAX_PER_ROOT = 400; // max_por_raiz
const MAX_DEPTH = 4; // profundidade_max
const MAX_FILE_BYTES = 512 * 1024;

export async function collectScripts(roots: readonly string[]): Promise<ScriptConfigEntry[]> {
  const found: ScriptConfigEntry[] = [];

  for (const rootPath of roots) {
    if (!(await isDir(rootPath))) continue;

    let count = 0;
    // One full pass per extension, in PADROES_SCRIPT order, capped at MAX_PER_ROOT matches.
    for (const ext of SCRIPT_EXTENSIONS) {
      if (count >= MAX_PER_ROOT) break;
      count = await scanExtension(rootPath, ext, count, found);
    }
  }

  found.sort((a, b) => (a.modificado < b.modificado ? 1 : a.modificado > b.modificado ? -1 : 0));
  return found;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function scanExtension(
  root: string,
  ext: string,
  startCount: number,
  out: ScriptConfigEntry[],
): Promise<number> {
  let count = startCount;

  async function walk(dir: string, depth: number): Promise<void> {
    if (count >= MAX_PER_ROOT) return;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirents) {
      if (count >= MAX_PER_ROOT) return;
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Any file reachable below here would exceed MAX_DEPTH; don't bother descending.
        if (depth >= MAX_DEPTH - 1) continue;
        if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && full.toLowerCase().endsWith(ext)) {
        const fileDepth = depth + 1;
        if (fileDepth > MAX_DEPTH) continue;
        if (IGNORE_PATH_RE.test(full)) continue;

        const entryResult = await inspectFile(full);
        if (entryResult) {
          out.push(entryResult);
          count += 1;
        }
      }
    }
  }

  await walk(root, 0);
  return count;
}

async function inspectFile(path: string): Promise<ScriptConfigEntry | null> {
  try {
    const st = await stat(path);
    if (st.size > MAX_FILE_BYTES) return null;

    const text = await readFile(path, 'utf8');
    const markers = [
      ...new Set(Array.from(text.matchAll(CONFIG_MARKER_RE), (m) => (m[0] ?? '').toLowerCase())),
    ]
      .filter((s) => s.length > 0)
      .sort();
    if (markers.length === 0) return null;

    return {
      caminho: path,
      nome: basename(path),
      tamanho_kb: round(st.size / 1024, 1),
      modificado: formatLocalIsoSeconds(st.mtimeMs),
      marcadores: markers.slice(0, 12),
      // Checked against the FULL marker set, not the truncated slice above — matches Python.
      mexe_em_gpu: GPU_HINT_RE.test(markers.join(' ')),
    };
  } catch {
    return null;
  }
}

/**
 * Local-time ISO-8601 with second precision, no offset — mirrors Python's
 * `datetime.fromtimestamp(mtime).isoformat(timespec="seconds")`, which uses the
 * system's local timezone as a naive datetime (unlike `Date#toISOString`, which
 * is always UTC with millisecond precision and a trailing "Z").
 */
function formatLocalIsoSeconds(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
