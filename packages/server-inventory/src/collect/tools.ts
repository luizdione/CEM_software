/**
 * Native port of the Python `coletar_ferramentas()`. Probes each CLI's path
 * via `Get-Command`, then tries a handful of version flags. Note: the Python
 * function also carries a vestigial, always-empty `scripts_config` key that
 * belongs to a separate top-level section — the ToolsSection contract has no
 * such field, so it is intentionally omitted here.
 */
import type { ToolInfo, ToolsSection } from '../types.js';
import { isWindows, runCommand, runWsl } from './exec.js';

const FERRAMENTAS_CLI = [
  'python',
  'conda',
  'mamba',
  'pip',
  'git',
  'docker',
  'wsl',
  'nvidia-smi',
  'nvcc',
  'R',
  'Rscript',
  'java',
  'nextflow',
  'snakemake',
  'samtools',
  'bcftools',
  'bedtools',
  'plink',
  'plink2',
  'bwa',
  'boltz',
  'ollama',
  'node',
  'npm',
  'cmake',
  'gcc',
  'pandoc',
  'ffmpeg',
  '7z',
] as const;

const VERSION_FLAGS = ['--version', '-version', 'version', '-V'] as const;

export async function collectTools(opts?: { timeoutMs?: number }): Promise<ToolsSection> {
  if (!isWindows) {
    return { cli: {}, erro: 'Windows-only' };
  }

  try {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const cli: Record<string, ToolInfo> = {};

    for (const ferramenta of FERRAMENTAS_CLI) {
      const probe = await runCommand(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Command ${ferramenta} -ErrorAction SilentlyContinue | Select-Object -First 1).Source`,
        ],
        { timeoutMs },
      );
      if (!probe.ok || !probe.stdout.trim()) continue;

      const entrada: { caminho: string; versao?: string } = { caminho: probe.stdout.trim() };

      for (const flag of VERSION_FLAGS) {
        let vok: boolean;
        let texto: string;
        if (ferramenta === 'wsl') {
          // wsl.exe emits UTF-16LE; runWsl decodes it (mirrors _decodificar_saida).
          const r = await runWsl([flag], { timeoutMs: 20_000 });
          vok = r.ok;
          texto = r.stdout.trim();
        } else {
          const r = await runCommand(ferramenta, [flag], { timeoutMs: 20_000 });
          vok = r.ok;
          texto = (r.stdout || r.stderr).trim();
        }
        if (vok && texto) {
          entrada.versao = (texto.split(/\r?\n/)[0] ?? '').slice(0, 160);
          break;
        }
      }

      cli[ferramenta] = entrada;
    }

    return { cli };
  } catch (err) {
    return { cli: {}, erro: err instanceof Error ? err.message : String(err) };
  }
}
