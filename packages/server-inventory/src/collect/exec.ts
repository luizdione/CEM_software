/**
 * Shared subprocess helpers for the native collectors. Mirrors the resolve-never-
 * reject pattern of `@cem/sync`'s `runGit` (packages/sync/src/git.ts): a failing
 * command yields `{ ok: false, ... }` instead of throwing, so a single missing
 * tool never aborts a whole inventory run.
 */
import { execFile } from 'node:child_process';

export interface CommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the process was killed by the timeout. */
  readonly timedOut: boolean;
}

export interface RunOptions {
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
  /** Extra environment for the child process (merged over process.env). */
  readonly env?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

/** True on Windows, where powershell/wsl/Get-Counter/powercfg exist. */
export const isWindows = process.platform === 'win32';

/**
 * Run a command and resolve with its decoded (UTF-8) output. Never rejects.
 * Always passes a `timeout` so a hung child (e.g. a stuck `wsl -d`) cannot leave
 * the caller awaiting forever.
 */
export function runCommand(cmd: string, args: readonly string[], opts: RunOptions = {}): Promise<CommandResult> {
  return runRaw(cmd, args, opts).then((r) => ({
    ok: r.ok,
    stdout: r.stdout.toString('utf8'),
    stderr: r.stderr.toString('utf8'),
    timedOut: r.timedOut,
  }));
}

interface RawResult {
  readonly ok: boolean;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly timedOut: boolean;
}

/** Run a command and resolve with raw Buffers (needed for UTF-16LE decoding). */
export function runRaw(cmd: string, args: readonly string[], opts: RunOptions = {}): Promise<RawResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args as string[],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
        encoding: 'buffer',
        ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      },
      (err: (Error & { killed?: boolean; signal?: string }) | null, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: (stdout as Buffer | undefined) ?? Buffer.alloc(0),
          stderr: (stderr as Buffer | undefined) ?? Buffer.alloc(0),
          timedOut: Boolean(err && (err.killed || err.signal === 'SIGTERM')),
        });
      },
    );
  });
}

/**
 * Decode output that may be UTF-16LE (as `wsl.exe` emits) or UTF-8. Mirrors the
 * Python collector's `_decodificar_saida`: if the buffer carries NUL bytes it is
 * UTF-16LE, otherwise plain UTF-8. Guards against the recurring `wsl` mojibake
 * bug documented in the original tool.
 */
export function decodeMaybeUtf16(buf: Buffer): string {
  return buf.includes(0x00) ? buf.toString('utf16le') : buf.toString('utf8');
}

/** Run `wsl.exe` (or any UTF-16LE emitter) and decode its stdout correctly. */
export async function runWsl(args: readonly string[], opts: RunOptions = {}): Promise<CommandResult> {
  const r = await runRaw('wsl', args, opts);
  return {
    ok: r.ok,
    stdout: decodeMaybeUtf16(r.stdout),
    stderr: decodeMaybeUtf16(r.stderr),
    timedOut: r.timedOut,
  };
}

/**
 * Run a PowerShell script and JSON.parse a `ConvertTo-Json` result. Returns null
 * on any failure (non-zero exit, empty output, or malformed JSON). Mirrors the
 * Python collector's `powershell_json()`.
 */
export async function powershellJson<T = unknown>(script: string, timeoutMs = DEFAULT_TIMEOUT): Promise<T | null> {
  if (!isWindows) return null;
  const wrapped =
    `$ProgressPreference='SilentlyContinue'; ` +
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ` +
    script;
  const r = await runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', wrapped], { timeoutMs });
  const text = r.stdout.trim();
  if (!r.ok || !text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * PowerShell's `ConvertTo-Json` returns a bare object (not a 1-element array)
 * when a query yields a single row. Normalize to an array. Mirrors `como_lista()`.
 */
export function asList<T>(value: T | readonly T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
}

/** Bytes → GB, rounded, or null for missing input. */
export function toGb(bytes: number | null | undefined, digits = 1): number | null {
  if (bytes == null || Number.isNaN(bytes)) return null;
  return round(bytes / 1024 ** 3, digits);
}

/** Round to `digits` decimals. */
export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Parse a numeric CSV/nvidia-smi field; `[N/A]`, empty, and junk become null. */
export function parseNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s || s === '[N/A]' || s.toUpperCase() === 'N/A' || s === '[Unknown Error]') return null;
  const n = Number(s.replace(/,/g, '.').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Trim a raw field to a clean string, mapping `[N/A]`/empty to a fallback. */
export function cleanStr(raw: string | null | undefined, fallback = ''): string {
  const s = (raw ?? '').trim();
  if (!s || s === '[N/A]') return fallback;
  return s;
}
