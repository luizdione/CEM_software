/**
 * Native port of the Python `coletar_wsl()`. WSL is Windows-only, so this
 * collector short-circuits everywhere else. Mirrors the UTF-16LE handling
 * `wsl.exe` requires (see `runWsl` in exec.ts) and the `.wslconfig` /
 * per-distro `.vhdx` lookups the original tool does for backup purposes.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WslConfig, WslDistro, WslSection } from '../types.js';
import { isWindows, parseNum, runCommand, runWsl, toGb } from './exec.js';

/** Strips readonly so a distro entry can be filled in incrementally across the collector's steps. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// Same bash probe script as the Python collector's coletar_wsl(), run once per
// distro via `wsl -d <name> -e bash -lc <script>`. Sections are delimited by
// "@@LABEL" markers and parsed back out below.
const INSPECT_SCRIPT = [
  `echo '@@DISTRO'; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); `,
  `echo '@@KERNEL'; uname -r; `,
  `echo '@@CPU'; nproc; `,
  `echo '@@MEM'; free -g | awk '/^Mem:/{print $2}'; `,
  `echo '@@NVIDIASMI'; (nvidia-smi --query-gpu=name,driver_version,memory.total `,
  `--format=csv,noheader 2>/dev/null || echo 'indisponivel'); `,
  `echo '@@CUDA'; (nvcc --version 2>/dev/null | tail -2 || echo 'sem nvcc'); `,
  `echo '@@CONDA'; (conda env list 2>/dev/null || echo 'sem conda'); `,
  `echo '@@PY'; (python3 --version 2>/dev/null || echo 'sem python3'); `,
  `echo '@@PIPBIO'; (pip list 2>/dev/null | grep -Ei `,
  `'^(torch|boltz|biopython|openmm|pdbfixer|mdanalysis|jax|tensorflow|cuequi|numpy|scipy|pandas)' `,
  `|| echo 'sem pip'); `,
  `echo '@@APTBIO'; (dpkg -l 2>/dev/null | grep -Ei `,
  `'nvidia-container|cuda|samtools|bcftools|bedtools|bwa|plink|nextflow|docker' `,
  `| awk '{print $2" "$3}' || echo 'sem dpkg'); `,
  `echo '@@DISCO'; df -h / | tail -1; `,
  `echo '@@FIM'`,
].join('');

/**
 * Collect WSL distros, `.wslconfig`, and (optionally) an internal per-distro
 * inspection. Unlike the Python default (`inspecionar=True`), this port
 * DEFAULTS TO SKIPPING inspection unless `opts.inspect === true` is passed
 * explicitly — per porting spec, the omitted/false case mirrors `--sem-wsl`.
 */
export async function collectWsl(opts?: { inspect?: boolean; timeoutMs?: number }): Promise<WslSection> {
  if (!isWindows) {
    return { disponivel: false, avisos: ['WSL is Windows-only'], versao: [], wslconfig: null, distros: [] };
  }

  const shortTimeout = opts?.timeoutMs ?? 30_000;
  const avisos: string[] = [];
  let versao: string[] = [];
  let wslconfig: WslConfig | null = null;
  const distros: Mutable<WslDistro>[] = [];

  try {
    // wsl.exe emits UTF-16LE; runWsl already decodes it (mirrors _decodificar_saida).
    const listed = await runWsl(['-l', '-v'], { timeoutMs: shortTimeout });
    if (!listed.ok) {
      return { disponivel: false, erro: listed.stderr || 'wsl indisponivel', avisos, versao, wslconfig, distros };
    }

    const bruto = listed.stdout.replace(/\ufeff/g, '');
    const linhas = bruto
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (linhas.length === 0) {
      return { disponivel: false, avisos, versao, wslconfig, distros };
    }

    for (const linha of linhas.slice(1)) {
      const m = /^(\*?)\s*(\S+)\s+(\S+)\s+(\d+)\s*$/.exec(linha);
      if (!m) continue;
      distros.push({
        nome: m[2] ?? '',
        estado: m[3] ?? '',
        versao_wsl: m[4] ?? '',
        padrao: m[1] === '*',
      });
    }

    // wsl --version also emits UTF-16LE; decode the same way (Python's T-0007 fix).
    const verResult = await runWsl(['--version'], { timeoutMs: shortTimeout });
    if (verResult.stdout) {
      versao = verResult.stdout
        .replace(/\ufeff/g, '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    }

    // .wslconfig controls the WSL2 VM's RAM/CPU/swap — a performance-relevant file.
    const wslConfigPath = join(homedir(), '.wslconfig');
    try {
      const conteudo = await readFile(wslConfigPath, 'utf8');
      wslconfig = { caminho: wslConfigPath, conteudo };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        avisos.push(
          'Sem ~/.wslconfig: a VM do WSL2 usa o padrao (ate 50% da RAM do host). ' +
            'Definir memory/processors evita disputa com jobs no Windows.',
        );
      }
      // Other read errors (e.g. permission denied): leave wslconfig as null,
      // no warning — mirrors the Python OSError catch that adds no message.
    }

    // Locate each distro's .vhdx — what needs to go into the backup.
    for (const d of distros) {
      const chaveBase = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss';
      const script =
        `Get-ChildItem '${chaveBase}' -ErrorAction SilentlyContinue | ` +
        `ForEach-Object { Get-ItemProperty $_.PSPath } | ` +
        `Where-Object { $_.DistributionName -eq '${d.nome}' } | ` +
        `Select-Object -ExpandProperty BasePath`;
      const r = await runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeoutMs: shortTimeout,
      });
      if (r.ok && r.stdout.trim()) {
        const base = r.stdout.trim().replace(/\\{2}\?\\/g, '');
        d.caminho_base = base;
        const vhdxPath = join(base, 'ext4.vhdx');
        try {
          const st = await stat(vhdxPath);
          if (st.isFile()) {
            d.vhdx_gb = toGb(st.size);
            d.vhdx = vhdxPath;
          }
        } catch {
          // no ext4.vhdx at that path — leave unset, mirrors Path.is_file() guard
        }
      }
    }

    if (opts?.inspect !== true) {
      avisos.push('Inspecao interna do WSL pulada (--sem-wsl).');
      return { disponivel: true, avisos, versao, wslconfig, distros };
    }

    for (const d of distros) {
      if (d.nome.toLowerCase() === 'docker-desktop' || d.nome.toLowerCase() === 'docker-desktop-data') {
        continue; // Docker's internal distros carry no user content
      }

      const estavaParada = d.estado.toLowerCase().startsWith('stop');
      d.estava_parada_antes_da_coleta = estavaParada;

      const insp = await runWsl(['-d', d.nome, '-e', 'bash', '-lc', INSPECT_SCRIPT], { timeoutMs: 120_000 });
      if (!insp.ok) {
        d.erro_inspecao = insp.stderr || 'falhou';
        continue;
      }

      const secoes: Record<string, string[]> = {};
      let atual: string | null = null;
      for (const linha of insp.stdout.split(/\r?\n/)) {
        if (linha.startsWith('@@')) {
          atual = linha.slice(2).trim();
          secoes[atual] = [];
        } else if (atual) {
          secoes[atual]?.push(linha.replace(/\s+$/, ''));
        }
      }
      const txt = (chave: string): string => (secoes[chave] ?? []).join('\n').trim();

      d.distro_nome = txt('DISTRO');
      d.kernel = txt('KERNEL');
      d.cpus = txt('CPU');
      // Contract types ram_gb as number|null (Python keeps the raw string); parse it here.
      d.ram_gb = parseNum(txt('MEM'));
      const gpuRaw = txt('NVIDIASMI');
      const gpuDisponivel = gpuRaw.length > 0 && !gpuRaw.toLowerCase().includes('indisponivel');
      d.gpu_visivel = gpuDisponivel;
      d.gpu_ok = gpuDisponivel;
      d.nvcc = txt('CUDA');
      d.conda = txt('CONDA');
      d.python = txt('PY');
      d.pacotes_pip = (secoes['PIPBIO'] ?? []).filter((l) => l.trim().length > 0);
      d.pacotes_apt = (secoes['APTBIO'] ?? []).filter((l) => l.trim().length > 0);
      d.disco = txt('DISCO');

      if (estavaParada) {
        avisos.push(
          `A distro '${d.nome}' estava parada e foi iniciada para a coleta. Para desligar: wsl -t ${d.nome}`,
        );
      }
    }

    return { disponivel: true, avisos, versao, wslconfig, distros };
  } catch (err) {
    return {
      disponivel: false,
      erro: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      avisos,
      versao,
      wslconfig,
      distros,
    };
  }
}
