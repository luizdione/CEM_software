/**
 * Native port of the Python `coletar_programas()`. Reads the 3 Uninstall
 * registry keys via `Get-ItemProperty` — NEVER `Win32_Product`, which
 * triggers an MSI repair as a side effect just by being queried.
 */
import type { Program, ProgramsSection } from '../types.js';
import { asList, isWindows, powershellJson, round, runCommand } from './exec.js';

/** Installer names worth surfacing (GPU/bioinfo/dev toolchain). Mirrors Python's PALAVRAS_RELEVANTES. */
const PALAVRAS_RELEVANTES =
  /nvidia|cuda|cudnn|tensorrt|docker|wsl|python|conda|miniforge|anaconda|\br\b|rstudio|rtools|git|visual studio|vs code|code|julia|perl|java|jdk|pymol|chimera|vmd|schrodinger|maestro|discovery studio|avogadro|jmol|blast|clustal|mega|geneious|snapgene|bioedit|graphpad|prism|imagej|fiji|cygwin|msys|mingw|cmake|ninja|ollama|lm studio|jupyter|spyder|matlab|origin|latex|miktex|texlive|pandoc|ffmpeg|7-zip|winrar|virtualbox|vmware/i;

interface RawUninstallEntry {
  readonly DisplayName?: string;
  readonly DisplayVersion?: string;
  readonly Publisher?: string;
  readonly InstallDate?: string;
  readonly EstimatedSize?: number;
}

const REGISTRY_SCRIPT = `
$chaves = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
Get-ItemProperty $chaves -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName } |
  Select-Object DisplayName,DisplayVersion,Publisher,InstallDate,EstimatedSize |
  Sort-Object DisplayName -Unique | ConvertTo-Json -Depth 2
`;

export async function collectPrograms(opts?: { timeoutMs?: number }): Promise<ProgramsSection> {
  if (!isWindows) {
    return { total: 0, erro: 'Windows-only', relevantes: [], todos: [], winget_disponivel: false };
  }

  try {
    const timeoutMs = opts?.timeoutMs ?? 30_000;

    // The registry scan can be slow across all 3 hives — matches Python's timeout=90.
    const lista = await powershellJson<RawUninstallEntry | RawUninstallEntry[]>(REGISTRY_SCRIPT, 90_000);
    if (lista === null) {
      return { total: 0, erro: 'sem saida', relevantes: [], todos: [], winget_disponivel: false };
    }

    const vistos = new Set<string>();
    const todos: Program[] = [];
    const relevantes: Program[] = [];

    for (const p of asList(lista)) {
      const nome = (p.DisplayName ?? '').trim();
      if (!nome) continue;
      const chave = nome.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      const estimatedSize = typeof p.EstimatedSize === 'number' ? p.EstimatedSize : 0;
      // Python's `round(...) or None` also folds an exact-zero result to None.
      const tamanhoMb = round(estimatedSize / 1024, 1) || null;

      const item: Program = {
        nome,
        versao: p.DisplayVersion ?? null,
        fabricante: p.Publisher ?? null,
        instalado_em: p.InstallDate ?? null,
        tamanho_mb: tamanhoMb,
      };
      todos.push(item);
      if (PALAVRAS_RELEVANTES.test(nome)) relevantes.push(item);
    }

    // winget export lets a restore reinstall everything in one shot.
    const wingetResult = await runCommand('winget', ['--version'], { timeoutMs });

    return {
      total: todos.length,
      relevantes,
      todos,
      winget_disponivel: wingetResult.ok,
      winget_versao: wingetResult.ok ? wingetResult.stdout.trim() : null,
    };
  } catch (err) {
    return {
      total: 0,
      erro: err instanceof Error ? err.message : String(err),
      relevantes: [],
      todos: [],
      winget_disponivel: false,
    };
  }
}
