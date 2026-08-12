/**
 * GPU collector: NVIDIA telemetry, throttle reasons, and per-process memory —
 * including the "sysmem fallback" metric (VRAM spilled to system RAM under
 * WDDM), which `nvidia-smi` itself never reports.
 *
 * Faithful port of `coletar_gpu()` from the Python `lupa_servidor` collector
 * (`coletar_inventario.py`). Field order, thresholds, and parsing quirks are
 * intentionally mirrored rather than "improved".
 */
import type {
  GpuSection,
  GpuDevice,
  GpuComputeProcess,
  GpuGraphicsProcess,
  GpuProcessMemory,
} from '../types.js';
import { runCommand, powershellJson, asList, round, parseNum, cleanStr, isWindows, toGb } from './exec.js';

/** Strips `readonly` from a type so we can build it up incrementally. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// Exact field order sent to `nvidia-smi --query-gpu=...`. Order matters: the
// CSV row is split on commas and re-zipped against this list. `ecc.mode.current`
// is queried (as in the Python source) but never read back — it exists only to
// keep the column count/alignment identical to the original tool.
const GPU_QUERY_FIELDS = [
  'index', 'name', 'driver_version', 'vbios_version', 'uuid',
  'memory.total', 'memory.used', 'memory.free', 'memory.reserved',
  'utilization.gpu', 'utilization.memory',
  'temperature.gpu', 'fan.speed',
  'power.draw', 'power.limit', 'power.max_limit', 'power.default_limit',
  'clocks.sm', 'clocks.max.sm', 'clocks.mem', 'clocks.max.mem',
  'pcie.link.gen.current', 'pcie.link.gen.max',
  'pcie.link.width.current', 'pcie.link.width.max',
  'compute_mode', 'persistence_mode', 'display_active', 'ecc.mode.current',
] as const;

/** Graphics-process line format printed by plain `nvidia-smi` (WDDM). */
const GRAPHICS_PROCESS_RE = /\|\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(C\+G|G|C)\s+(.+?)\s+(N\/A|\d+MiB)\s*\|/;

function unavailable(erro: string): GpuSection {
  return {
    disponivel: false,
    erro,
    gpus: [],
    processos: [],
    avisos: [],
    memoria_por_processo: [],
    sysmem_fallback_gb: 0,
  };
}

/**
 * Collect NVIDIA GPU telemetry, throttle reasons, compute/graphics
 * processes, and the sysmem-fallback breakdown. Never throws.
 */
export async function collectGpu(opts?: { timeoutMs?: number }): Promise<GpuSection> {
  try {
    if (!isWindows) {
      return unavailable('GPU collection requires Windows (nvidia-smi + Get-Counter).');
    }

    // Base timeout for nvidia-smi query/textual calls. The two Get-Counter
    // calls below are always 60s regardless of this override — they are
    // structurally slower (perf counters) and pinned by the original tool.
    const shortTimeout = opts?.timeoutMs ?? 30_000;
    const counterTimeout = 60_000;

    const gpuQuery = await runCommand(
      'nvidia-smi',
      [`--query-gpu=${GPU_QUERY_FIELDS.join(',')}`, '--format=csv,noheader,nounits'],
      { timeoutMs: shortTimeout },
    );
    if (!gpuQuery.ok) {
      const erro = gpuQuery.stderr.trim() || (gpuQuery.timedOut ? 'nvidia-smi timeout' : 'nvidia-smi indisponivel');
      return unavailable(erro);
    }

    const gpus: GpuDevice[] = [];
    for (const linha of gpuQuery.stdout.split(/\r?\n/)) {
      const valores = linha.split(',').map((v) => v.trim());
      if (valores.length !== GPU_QUERY_FIELDS.length) continue;

      const g: Record<string, string> = {};
      GPU_QUERY_FIELDS.forEach((campo, i) => {
        g[campo] = valores[i] ?? '';
      });
      const num = (chave: string): number | null => parseNum(g[chave]);
      const str = (chave: string): string => cleanStr(g[chave]);

      const total = num('memory.total');
      const usada = num('memory.used');
      gpus.push({
        indice: str('index'),
        nome: str('name'),
        driver: str('driver_version'),
        vbios: str('vbios_version'),
        uuid: str('uuid'),
        vram_total_mib: total,
        vram_usada_mib: usada,
        vram_livre_mib: num('memory.free'),
        vram_reservada_mib: num('memory.reserved'),
        // Python: `if total and usada` — both 0 and null are falsy, so a 0-MiB
        // reading (as well as a missing reading) yields null here too.
        vram_uso_pct: total && usada ? round((100 * usada) / total, 1) : null,
        util_gpu_pct: num('utilization.gpu'),
        util_mem_pct: num('utilization.memory'),
        temperatura_c: num('temperature.gpu'),
        fan_pct: num('fan.speed'),
        potencia_w: num('power.draw'),
        potencia_limite_w: num('power.limit'),
        potencia_limite_max_w: num('power.max_limit'),
        potencia_limite_padrao_w: num('power.default_limit'),
        clock_sm_mhz: num('clocks.sm'),
        clock_sm_max_mhz: num('clocks.max.sm'),
        clock_mem_mhz: num('clocks.mem'),
        clock_mem_max_mhz: num('clocks.max.mem'),
        pcie_gen: `${str('pcie.link.gen.current')}/${str('pcie.link.gen.max')}`,
        pcie_largura: `x${str('pcie.link.width.current')}/x${str('pcie.link.width.max')}`,
        modo_computacao: str('compute_mode'),
        modo_persistencia: str('persistence_mode'),
        display_ativo: str('display_active'),
      });
    }

    // CUDA runtime the installed driver supports, parsed from textual output.
    let cudaDriver: string | undefined;
    const textForCuda = await runCommand('nvidia-smi', [], { timeoutMs: shortTimeout });
    if (textForCuda.ok) {
      const m = /CUDA Version:\s*([\d.]+)/.exec(textForCuda.stdout);
      if (m) cudaDriver = m[1];
    }

    // Clock throttle reasons: same indentation-walk parser as the Python
    // source (nvidia-smi -q has no machine-friendly structured mode here).
    let motivosThrottle: Record<string, string> | undefined;
    let throttleAtivo: string[] | undefined;
    const perf = await runCommand('nvidia-smi', ['-q', '-d', 'PERFORMANCE'], { timeoutMs: shortTimeout });
    if (perf.ok) {
      const motivos: Record<string, string> = {};
      let dentro = false;
      for (const linha of perf.stdout.split(/\r?\n/)) {
        if (linha.includes('Clocks Event Reasons')) {
          dentro = !linha.includes('Counters');
          continue;
        }
        if (dentro) {
          if (linha.includes(':') && linha.startsWith(' '.repeat(8))) {
            const idx = linha.indexOf(':');
            motivos[linha.slice(0, idx).trim()] = linha.slice(idx + 1).trim();
          } else if (linha.trim() && !linha.startsWith(' '.repeat(8))) {
            dentro = false;
          }
        }
      }
      motivosThrottle = motivos;
      throttleAtivo = Object.entries(motivos)
        .filter(([, v]) => v === 'Active')
        .map(([k]) => k);
    }

    // Compute-mode processes (pid/name/VRAM as nvidia-smi reports natively).
    const processos: Mutable<GpuComputeProcess>[] = [];
    const computeApps = await runCommand(
      'nvidia-smi',
      ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'],
      { timeoutMs: shortTimeout },
    );
    if (computeApps.ok && computeApps.stdout) {
      for (const linha of computeApps.stdout.split(/\r?\n/)) {
        const partes = linha.split(',').map((p) => p.trim());
        if (partes.length >= 2) {
          processos.push({
            pid: partes[0] ?? '',
            nome: partes[1] ?? '',
            vram_mib: partes.length > 2 ? (partes[2] ?? null) : null,
            tipo: 'compute',
          });
        }
      }
    }

    // On Windows/WDDM nvidia-smi does not report per-process VRAM; the full
    // process list (incl. graphics apps) only comes from the textual dump.
    let processosTodos: GpuGraphicsProcess[] | undefined;
    let nProcessosGraficos: number | undefined;
    const textForProcesses = await runCommand('nvidia-smi', [], { timeoutMs: shortTimeout });
    if (textForProcesses.ok && textForProcesses.stdout.includes('Processes:')) {
      const marker = 'Processes:';
      const bloco = textForProcesses.stdout.slice(textForProcesses.stdout.indexOf(marker) + marker.length);
      const graficos: GpuGraphicsProcess[] = [];
      for (const linha of bloco.split(/\r?\n/)) {
        const m = GRAPHICS_PROCESS_RE.exec(linha);
        if (m) {
          graficos.push({
            pid: m[1] ?? '',
            tipo: m[2] ?? '',
            nome: (m[3] ?? '').trim(),
            vram_mib: m[4] ?? '',
          });
        }
      }
      processosTodos = graficos;
      // Graphics apps compete with compute jobs for the same VRAM budget.
      nProcessosGraficos = graficos.filter((p) => p.tipo.includes('G')).length;
    }

    // Sysmem fallback: split VRAM (Local Usage) from RAM/PCIe spillover (Non
    // Local Usage) per process, joined by the pid parsed from the counter's
    // InstanceName ("pid_1234_..."). Non Local Usage is the metric nvidia-smi
    // hides under WDDM — it's the driver quietly serving a CUDA allocation
    // out of host RAM once VRAM is exhausted, ~10-100x slower than VRAM.
    const porProcesso: Mutable<GpuProcessMemory>[] = [];

    const localAmostras = await powershellJson<
      ReadonlyArray<{ InstanceName?: string; CookedValue?: number }> | { InstanceName?: string; CookedValue?: number }
    >(
      "(Get-Counter '\\GPU Process Memory(*)\\Local Usage' -ErrorAction SilentlyContinue).CounterSamples | " +
        'Where-Object {$_.CookedValue -gt 52428800} | Select-Object InstanceName,CookedValue | ConvertTo-Json',
      counterTimeout,
    );
    for (const a of asList(localAmostras)) {
      const m = /^pid_(\d+)_/.exec(a.InstanceName ?? '');
      if (!m) continue;
      const pid = m[1] ?? '';
      const valor = round((a.CookedValue ?? 0) / 1024 ** 3, 2);
      let entrada = porProcesso.find((x) => x.pid === pid);
      if (!entrada) {
        entrada = { pid, vram_gb: 0, ram_gb: 0, total_gb: 0 };
        porProcesso.push(entrada);
      }
      entrada.vram_gb += valor;
    }

    const nonLocalAmostras = await powershellJson<
      ReadonlyArray<{ InstanceName?: string; CookedValue?: number }> | { InstanceName?: string; CookedValue?: number }
    >(
      "(Get-Counter '\\GPU Process Memory(*)\\Non Local Usage' -ErrorAction SilentlyContinue).CounterSamples | " +
        'Where-Object {$_.CookedValue -gt 52428800} | Select-Object InstanceName,CookedValue | ConvertTo-Json',
      counterTimeout,
    );
    for (const a of asList(nonLocalAmostras)) {
      const m = /^pid_(\d+)_/.exec(a.InstanceName ?? '');
      if (!m) continue;
      const pid = m[1] ?? '';
      const valor = round((a.CookedValue ?? 0) / 1024 ** 3, 2);
      let entrada = porProcesso.find((x) => x.pid === pid);
      if (!entrada) {
        entrada = { pid, vram_gb: 0, ram_gb: 0, total_gb: 0 };
        porProcesso.push(entrada);
      }
      entrada.ram_gb += valor;
    }

    let sysmemFallbackGb = 0;
    for (const entrada of porProcesso) {
      entrada.total_gb = round(entrada.vram_gb + entrada.ram_gb, 2);
      const info = await powershellJson<{ Name?: string | null; CommandLine?: string | null }>(
        `Get-CimInstance Win32_Process -Filter 'ProcessId=${entrada.pid}' | Select-Object Name,CommandLine | ConvertTo-Json`,
      );
      if (info) {
        if (info.Name != null) entrada.nome = info.Name;
        entrada.linha_comando = info.CommandLine ?? null;
      }
      sysmemFallbackGb += entrada.ram_gb;
    }
    sysmemFallbackGb = round(sysmemFallbackGb, 2);
    porProcesso.sort((a, b) => b.total_gb - a.total_gb);

    // Enrich compute processes with real command line / start time / RSS.
    for (const proc of processos) {
      const info = await powershellJson<{
        CommandLine?: string | null;
        CreationDate?: string | null;
        WorkingSetSize?: number | null;
      }>(
        `Get-CimInstance Win32_Process -Filter 'ProcessId=${proc.pid}' | ` +
          'Select-Object CommandLine,CreationDate,WorkingSetSize | ConvertTo-Json',
      );
      if (info) {
        proc.linha_comando = info.CommandLine ?? null;
        // Python does `str(info.get("CreationDate"))`, which literally yields
        // the string "None" when absent. We use null instead, matching the
        // nullable contract of `iniciado_em` rather than that Python quirk.
        proc.iniciado_em = info.CreationDate != null ? String(info.CreationDate) : null;
        proc.ram_gb = toGb(info.WorkingSetSize ?? null);
      }
    }

    return {
      disponivel: true,
      gpus,
      processos,
      avisos: [],
      motivos_throttle: motivosThrottle,
      throttle_ativo: throttleAtivo,
      processos_todos: processosTodos,
      n_processos_graficos: nProcessosGraficos,
      memoria_por_processo: porProcesso,
      sysmem_fallback_gb: sysmemFallbackGb,
      cuda_driver: cudaDriver,
    };
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : String(err));
  }
}
