import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadConfig, saveConfig } from './config.js';
import { getCemConfigPath } from './paths.js';

let dirs: string[] = [];
async function tempEnv(): Promise<{ home: string; platform: 'linux'; env: Record<string, string> }> {
  const home = await mkdtemp(join(tmpdir(), 'cem-config-'));
  dirs.push(home);
  return { home, platform: 'linux', env: { XDG_CONFIG_HOME: join(home, '.config') } };
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('loadConfig resilience', () => {
  it('falls back to defaults for a corrupt config instead of throwing', async () => {
    const env = await tempEnv();
    const path = getCemConfigPath(env);
    await mkdir(dirname(path), { recursive: true });
    // Truncated JSON — exactly what a power loss / crash mid-save leaves behind.
    await writeFile(path, '{ "theme": "dark", ', 'utf8');

    const config = await loadConfig(undefined, env);
    // Did not throw, and fell back to the defaults.
    expect(config.telemetry).toBe(false);
    expect(config.theme).toBe('system');

    // The bad file is preserved alongside for inspection.
    const preserved = await readFile(`${path}.corrupt`, 'utf8');
    expect(preserved).toContain('theme');
  });

  it('round-trips a valid config', async () => {
    const env = await tempEnv();
    const base = await loadConfig(undefined, env);
    await saveConfig({ ...base, theme: 'dark' }, undefined, env);
    const reloaded = await loadConfig(undefined, env);
    expect(reloaded.theme).toBe('dark');
    expect(reloaded.telemetry).toBe(false);
  });
});
