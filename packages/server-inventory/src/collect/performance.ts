/**
 * Performance-config collector: power plan, HAGS/TDR registry keys, pagefile,
 * VBS, antivirus, NVIDIA NVTweak dump and performance-relevant env vars. Ported
 * 1:1 from the Python `coletar_config_desempenho()` (coletar_inventario.py),
 * including its `_ler_registro()` helper and the `ENV_DESEMPENHO` constant.
 * Windows-only — the underlying probes (powercfg, registry, WMI) don't exist
 * elsewhere.
 */
import { powershellJson, runCommand, asList, parseNum, isWindows } from './exec.js';
import type {
  AntivirusProduct,
  InventoryError,
  PageFileUsage,
  PerformanceConfig,
  WindowsPerfConfig,
} from '../types.js';

const DEFAULT_TIMEOUT = 30_000;

// Env vars that affect CPU/GPU performance — mirrors Python's ENV_DESEMPENHO.
const ENV_DESEMPENHO: readonly string[] = [
  'CUDA_VISIBLE_DEVICES', 'CUDA_DEVICE_ORDER', 'CUDA_HOME', 'CUDA_PATH',
  'CUDA_LAUNCH_BLOCKING', 'CUDA_MODULE_LOADING', 'CUDA_CACHE_MAXSIZE',
  'PYTORCH_CUDA_ALLOC_CONF', 'PYTORCH_NO_CUDA_MEMORY_CACHING',
  'TORCH_CUDA_ARCH_LIST', 'TORCH_HOME', 'TORCHINDUCTOR_CACHE_DIR',
  'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS',
  'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'OMP_PROC_BIND',
  'KMP_AFFINITY', 'KMP_BLOCKTIME', 'MKL_DYNAMIC',
  'NVIDIA_VISIBLE_DEVICES', 'NVIDIA_DRIVER_CAPABILITIES',
  'HF_HOME', 'HUGGINGFACE_HUB_CACHE', 'TRANSFORMERS_CACHE',
  'TMPDIR', 'TEMP', 'TMP', 'CONDA_PREFIX', 'CONDA_ENVS_PATH',
  'XLA_PYTHON_CLIENT_PREALLOCATE', 'XLA_PYTHON_CLIENT_MEM_FRACTION',
];

// The "CUDA - Sysmem Fallback Policy" toggle is only readable via NVAPI/NVCP —
// there is no registry/WMI probe, so this is a static pointer to the GUI.
const RECOMENDACAO_NVIDIA_SYSMEM =
  "Painel de Controle NVIDIA > Gerenciar configuracoes 3D > " +
  "'CUDA - Sysmem Fallback Policy': para cargas CUDA pesadas, use " +
  "'Prefer No Sysmem Fallback' (falha rapido em vez de degradar).";

interface WmiDeviceGuard {
  readonly VirtualizationBasedSecurityStatus?: number | null;
  readonly SecurityServicesRunning?: unknown;
}

interface WmiAntivirusProduct {
  readonly displayName?: string | null;
  readonly productState?: number | null;
}

/** Mirrors Python's `_ler_registro()`: a single named value, or null. */
async function readRegistryValue(path: string, name: string, timeoutMs: number): Promise<string | null> {
  const r = await runCommand(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-ItemProperty -Path '${path}' -Name '${name}' -ErrorAction SilentlyContinue).'${name}'`,
    ],
    { timeoutMs },
  );
  const out = r.stdout.trim();
  return r.ok && out ? out : null;
}

/** Env vars persisted in the registry (user or machine scope), filtered to ENV_DESEMPENHO. */
async function readPersistentEnv(registryPath: string, timeoutMs: number): Promise<Record<string, string>> {
  const raw = await powershellJson<Record<string, unknown>>(
    `Get-ItemProperty '${registryPath}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 2`,
    timeoutMs,
  );
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const [k, v] of Object.entries(raw)) {
    if (ENV_DESEMPENHO.includes(k) || ENV_DESEMPENHO.includes(k.toUpperCase())) {
      result[k] = String(v);
    }
  }
  return result;
}

export async function collectPerformanceConfig(
  opts: { timeoutMs?: number } = {},
): Promise<PerformanceConfig | InventoryError> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  if (!isWindows) return { erro: 'Performance config is Windows-only' };

  try {
    // --- Windows -----------------------------------------------------------
    let planoEnergia: string | null = null;
    let planoAltoDesempenho = false;
    const powercfgResult = await runCommand('powercfg', ['/getactivescheme'], { timeoutMs });
    if (powercfgResult.ok) {
      const out = powercfgResult.stdout.trim();
      planoEnergia = out;
      planoAltoDesempenho = /(Alto desempenho|High performance|Desempenho m[aá]ximo|Ultimate)/i.test(out);
    }

    // HwSchMode only exists in the registry once someone touches the option;
    // absent means "driver default", not "off".
    const graphicsDriversKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers';
    const hagsRaw = await readRegistryValue(graphicsDriversKey, 'HwSchMode', timeoutMs);
    const tdrlevel = await readRegistryValue(graphicsDriversKey, 'TdrLevel', timeoutMs);
    const tdrdelay = await readRegistryValue(graphicsDriversKey, 'TdrDelay', timeoutMs);
    const tdrddidelay = await readRegistryValue(graphicsDriversKey, 'TdrDdiDelay', timeoutMs);

    // Virtual memory: pipelines that blow past RAM depend on the pagefile.
    const pagefileRaw = await powershellJson<PageFileUsage | PageFileUsage[]>(
      'Get-CimInstance Win32_PageFileUsage | ' +
        'Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage | ConvertTo-Json',
      timeoutMs,
    );

    // Core isolation / VBS costs performance on virtualization and I/O.
    const vbsRaw = await powershellJson<WmiDeviceGuard>(
      'Get-CimInstance -ClassName Win32_DeviceGuard ' +
        '-Namespace root\\Microsoft\\Windows\\DeviceGuard | ' +
        'Select-Object VirtualizationBasedSecurityStatus,' +
        'SecurityServicesRunning | ConvertTo-Json',
      timeoutMs,
    );

    // Third-party antivirus can intercept I/O for heavy pipelines.
    const avRaw = await powershellJson<WmiAntivirusProduct | WmiAntivirusProduct[]>(
      'Get-CimInstance -Namespace root\\SecurityCenter2 -ClassName AntiVirusProduct ' +
        '-ErrorAction SilentlyContinue | Select-Object displayName,productState | ConvertTo-Json',
      timeoutMs,
    );
    const antivirus: AntivirusProduct[] = asList<WmiAntivirusProduct>(avRaw).map((a) => ({
      nome: a.displayName ?? '',
      estado: a.productState ?? null,
    }));

    const windows: WindowsPerfConfig = {
      plano_energia: planoEnergia,
      plano_alto_desempenho: planoAltoDesempenho,
      hags_hwschmode: parseNum(hagsRaw),
      hags_ativo: hagsRaw ? hagsRaw === '2' : null,
      hags_indeterminado: hagsRaw == null,
      tdrlevel,
      tdrdelay,
      tdrddidelay,
      pagefile: asList<PageFileUsage>(pagefileRaw),
      vbs_status: vbsRaw?.VirtualizationBasedSecurityStatus ?? null,
      vbs_ativo: vbsRaw?.VirtualizationBasedSecurityStatus === 2,
      antivirus,
    };

    // --- NVIDIA --------------------------------------------------------------
    // Opaque registry dump — shape is driver-specific, kept as unknown.
    const nvtweak = await powershellJson<unknown>(
      "Get-ItemProperty 'HKLM:\\SOFTWARE\\NVIDIA Corporation\\Global\\NVTweak' " +
        '-ErrorAction SilentlyContinue | ConvertTo-Json -Depth 2',
      timeoutMs,
    );

    // --- environment variables -----------------------------------------------
    const variaveisAmbiente: Record<string, string> = {};
    for (const key of ENV_DESEMPENHO) {
      const value = process.env[key];
      if (value) variaveisAmbiente[key] = value;
    }

    const [envPersistenteUsuario, envPersistenteMaquina] = await Promise.all([
      readPersistentEnv('HKCU:\\Environment', timeoutMs),
      readPersistentEnv('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', timeoutMs),
    ]);

    return {
      windows,
      nvidia: { nvtweak },
      variaveis_ambiente: variaveisAmbiente,
      recomendacoes_leitura: [RECOMENDACAO_NVIDIA_SYSMEM],
      env_persistente_usuario: envPersistenteUsuario,
      env_persistente_maquina: envPersistenteMaquina,
    };
  } catch (e) {
    // Never throw — an unexpected failure just collapses to a section error.
    return { erro: `config_desempenho: ${e instanceof Error ? e.message : String(e)}` };
  }
}
