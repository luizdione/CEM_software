import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile, rename, stat, readdir, rm, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

/** Replace a leading `~` with the current user's home directory. */
export function expandHome(inputPath: string): string {
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith(`~${sep}`) || inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/** True when the path exists and is accessible. */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Create a directory (and parents) if it does not already exist. */
export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

/** Read a UTF-8 text file. */
export async function readText(target: string): Promise<string> {
  return readFile(target, 'utf8');
}

/**
 * Write a UTF-8 text file, creating parent directories as needed.
 *
 * The write is atomic: content is written to a temporary sibling which is then
 * renamed over the target. A crash mid-write (power loss, a GPU-driver reset
 * that takes the whole app down) can therefore never leave a truncated or
 * half-written file — a later read always sees either the previous complete
 * file or the new one. CEM's own state files (config, history) are otherwise
 * easy to corrupt when the machine dies while they are being saved, which then
 * prevents the app from starting.
 */
export async function writeText(target: string, content: string): Promise<void> {
  await ensureDir(dirname(target));
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await writeFile(tmp, content, 'utf8');
    await renameWithRetry(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * `rename` over an existing file is atomic, but on Windows it can transiently
 * fail with EPERM/EBUSY when an antivirus or sync client (e.g. OneDrive) holds
 * the file open for a moment. Retry a few times with a short backoff before
 * surfacing the error.
 */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
    }
  }
}

/** Parse a JSON file into a typed value. */
export async function readJson<T = unknown>(target: string): Promise<T> {
  const raw = await readText(target);
  return JSON.parse(raw) as T;
}

/** Serialize a value as pretty-printed JSON and write it to disk. */
export async function writeJson(target: string, data: unknown, indent = 2): Promise<void> {
  await writeText(target, `${JSON.stringify(data, null, indent)}\n`);
}

export interface FileStat {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

/** Stat a path, returning `null` instead of throwing when it is missing. */
export async function safeStat(target: string): Promise<FileStat | null> {
  try {
    const s = await stat(target);
    return {
      path: target,
      size: s.size,
      mtimeMs: s.mtimeMs,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
    };
  } catch {
    return null;
  }
}

export interface WalkEntry {
  /** Absolute path to the file. */
  readonly path: string;
  /** Path relative to the walk root, using forward slashes. */
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface WalkOptions {
  /** Directory names to skip entirely. */
  readonly ignoreDirs?: readonly string[];
  /** Maximum recursion depth (0 = only the root directory). */
  readonly maxDepth?: number;
  /** Follow no symlinks by default to avoid cycles. */
  readonly followSymlinks?: boolean;
}

const DEFAULT_IGNORE_DIRS = ['node_modules', '.git', '.cache', 'dist', 'out', '.turbo'];

/**
 * Recursively list every file beneath `root`. Directories in `ignoreDirs`
 * are pruned. Returns entries with sizes and modification times.
 */
export async function walk(root: string, options: WalkOptions = {}): Promise<WalkEntry[]> {
  const ignore = new Set(options.ignoreDirs ?? DEFAULT_IGNORE_DIRS);
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const results: WalkEntry[] = [];
  const rootResolved = resolve(root);

  async function recurse(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignore.has(entry.name) || depth >= maxDepth) continue;
        await recurse(full, depth + 1);
      } else if (entry.isFile() || (options.followSymlinks && entry.isSymbolicLink())) {
        const s = await safeStat(full);
        if (!s) continue;
        results.push({
          path: full,
          relativePath: full.slice(rootResolved.length + 1).split(sep).join('/'),
          size: s.size,
          mtimeMs: s.mtimeMs,
        });
      }
    }
  }

  await recurse(rootResolved, 0);
  return results;
}

/** Copy a file, creating the destination directory if needed. */
export async function copyFileEnsured(src: string, dest: string): Promise<void> {
  await ensureDir(dirname(dest));
  await copyFile(src, dest);
}

/** Remove a file or directory recursively; a no-op when the path is missing. */
export async function removePath(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}
