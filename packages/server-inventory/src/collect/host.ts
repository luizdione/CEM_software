/**
 * Host collector: OS identity, CPU, RAM and disks. Ported 1:1 from the Python
 * `coletar_host()` in the legacy `lupa_servidor` tool (coletar_inventario.py).
 * Identity fields (hostname/os/os_versao/arquitetura) come from `node:os` on
 * every platform — Python sourced them from `platform.*`, which has no exact
 * Node equivalent, so this is the closest reasonable match. Everything else is
 * WMI (Get-CimInstance) on Windows, degrading field-by-field exactly like the
 * Python version did with its `if x:` guards.
 */
import { arch, cpus, freemem, hostname, release, totalmem, type } from 'node:os';
import { powershellJson, asList, toGb, round, isWindows } from './exec.js';
import type { CpuInfo, DiskVolume, InventoryHost, PhysicalDisk, RamStick } from '../types.js';

const DEFAULT_TIMEOUT = 30_000;

interface WmiOperatingSystem {
  readonly Caption?: string | null;
  readonly Version?: string | null;
  readonly BuildNumber?: string | null;
  readonly OSArchitecture?: string | null;
  readonly TotalVisibleMemorySize?: number | null;
  readonly FreePhysicalMemory?: number | null;
  readonly LastBootUpTime?: string | null;
}

interface WmiProcessor {
  readonly Name?: string | null;
  readonly NumberOfCores?: number | null;
  readonly NumberOfLogicalProcessors?: number | null;
  readonly MaxClockSpeed?: number | null;
  readonly CurrentClockSpeed?: number | null;
  readonly L3CacheSize?: number | null;
  readonly VirtualizationFirmwareEnabled?: boolean | null;
}

interface WmiLogicalDisk {
  readonly DeviceID?: string | null;
  readonly VolumeName?: string | null;
  readonly FileSystem?: string | null;
  readonly Size?: number | null;
  readonly FreeSpace?: number | null;
}

interface WmiPhysicalDisk {
  readonly FriendlyName?: string | null;
  readonly MediaType?: string | null;
  readonly SizeGB?: number | null;
  readonly BusType?: string | null;
  readonly HealthStatus?: string | null;
}

interface WmiBaseBoard {
  readonly Manufacturer?: string | null;
  readonly Product?: string | null;
}

interface WmiPhysicalMemory {
  readonly Manufacturer?: string | null;
  readonly Capacity?: number | null;
  readonly Speed?: number | null;
  readonly ConfiguredClockSpeed?: number | null;
}

/** Identity fields shared by every path — closest node:os match to `platform.*`. */
function identity(): Pick<InventoryHost, 'hostname' | 'os' | 'os_versao' | 'arquitetura'> {
  return {
    hostname: hostname(),
    os: `${type()} ${release()}`,
    os_versao: release(),
    arquitetura: arch(),
  };
}

/** CPU built from `os.cpus()` alone — used when WMI is unavailable. */
function fallbackCpu(): CpuInfo {
  const list = cpus();
  return {
    modelo: list[0]?.model ?? '',
    nucleos_fisicos: null,
    nucleos_logicos: list.length || null,
    clock_max_mhz: null,
    clock_atual_mhz: null,
    cache_l3_kb: null,
    virtualizacao_firmware: null,
  };
}

/** Full node:os-only host, used off-Windows and when WMI cannot be reached at all. */
function hostFromOs(): InventoryHost {
  return {
    ...identity(),
    ram_total_gb: toGb(totalmem()),
    ram_livre_gb: toGb(freemem()),
    cpu: fallbackCpu(),
    discos: [],
    discos_fisicos: [],
    pentes_ram: [],
  };
}

export async function collectHost(opts: { timeoutMs?: number } = {}): Promise<InventoryHost> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  try {
    if (!isWindows) return hostFromOs();

    const so = await powershellJson<WmiOperatingSystem>(
      'Get-CimInstance Win32_OperatingSystem | ' +
        'Select-Object Caption,Version,BuildNumber,OSArchitecture,' +
        'TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime | ConvertTo-Json',
      timeoutMs,
    );
    // No CIM access at all (locked-down account, broken WMI repo): degrade wholesale.
    if (!so) return hostFromOs();

    // WMI reports memory in KiB.
    const totalKb = so.TotalVisibleMemorySize ?? 0;
    const livreKb = so.FreePhysicalMemory ?? 0;

    const cpuRaw = await powershellJson<WmiProcessor | WmiProcessor[]>(
      'Get-CimInstance Win32_Processor | ' +
        'Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,' +
        'MaxClockSpeed,CurrentClockSpeed,L2CacheSize,L3CacheSize,' +
        'VirtualizationFirmwareEnabled | ConvertTo-Json',
      timeoutMs,
    );
    const c = asList<WmiProcessor>(cpuRaw)[0];
    const cpu: CpuInfo | undefined = c
      ? {
          modelo: (c.Name ?? '').trim(),
          nucleos_fisicos: c.NumberOfCores ?? null,
          nucleos_logicos: c.NumberOfLogicalProcessors ?? null,
          clock_max_mhz: c.MaxClockSpeed ?? null,
          clock_atual_mhz: c.CurrentClockSpeed ?? null,
          cache_l3_kb: c.L3CacheSize ?? null,
          virtualizacao_firmware: c.VirtualizationFirmwareEnabled ?? null,
        }
      : undefined;

    const discosRaw = await powershellJson<WmiLogicalDisk | WmiLogicalDisk[]>(
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | " +
        'Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace | ConvertTo-Json',
      timeoutMs,
    );
    const discos: DiskVolume[] = asList<WmiLogicalDisk>(discosRaw).map((d) => {
      const total = d.Size ?? 0;
      const livre = d.FreeSpace ?? 0;
      return {
        unidade: d.DeviceID ?? null,
        rotulo: d.VolumeName ?? null,
        fs: d.FileSystem ?? null,
        total_gb: round(total / 1024 ** 3, 1),
        livre_gb: round(livre / 1024 ** 3, 1),
        uso_pct: total ? round(100 * (1 - livre / total), 1) : null,
      };
    });

    // Physical disks: SSD vs HDD matters for pipeline I/O.
    const fisicosRaw = await powershellJson<WmiPhysicalDisk | WmiPhysicalDisk[]>(
      'Get-PhysicalDisk | Select-Object FriendlyName,MediaType,' +
        "@{n='SizeGB';e={[math]::Round($_.Size/1GB,0)}},BusType,HealthStatus | ConvertTo-Json",
      timeoutMs,
    );
    const discosFisicos: PhysicalDisk[] = asList<WmiPhysicalDisk>(fisicosRaw).map((f) => ({
      modelo: f.FriendlyName ?? null,
      tipo: f.MediaType ?? null,
      tamanho_gb: f.SizeGB ?? null,
      barramento: f.BusType ?? null,
      saude: f.HealthStatus ?? null,
    }));

    const placaRaw = await powershellJson<WmiBaseBoard>(
      'Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product | ConvertTo-Json',
      timeoutMs,
    );
    const placaMae = placaRaw ? `${placaRaw.Manufacturer ?? ''} ${placaRaw.Product ?? ''}`.trim() : null;

    const memoriasRaw = await powershellJson<WmiPhysicalMemory | WmiPhysicalMemory[]>(
      'Get-CimInstance Win32_PhysicalMemory | ' +
        'Select-Object Manufacturer,Capacity,Speed,ConfiguredClockSpeed | ConvertTo-Json',
      timeoutMs,
    );
    const pentesRam: RamStick[] = asList<WmiPhysicalMemory>(memoriasRaw).map((m) => ({
      fabricante: (m.Manufacturer ?? '').trim(),
      capacidade_gb: toGb(m.Capacity, 0),
      velocidade_mhz: m.Speed ?? null,
      clock_configurado_mhz: m.ConfiguredClockSpeed ?? null,
    }));

    return {
      ...identity(),
      os_nome: so.Caption ?? undefined,
      os_build: so.BuildNumber ?? undefined,
      ram_total_gb: round(totalKb / 1024 ** 2, 1),
      ram_livre_gb: round(livreKb / 1024 ** 2, 1),
      ram_uso_pct: totalKb ? round(100 * (1 - livreKb / totalKb), 1) : undefined,
      ultimo_boot: so.LastBootUpTime != null ? String(so.LastBootUpTime) : null,
      placa_mae: placaMae,
      cpu,
      discos,
      discos_fisicos: discosFisicos,
      pentes_ram: pentesRam,
    };
  } catch {
    // Never throw — an unavailable/unusual environment just degrades to node:os.
    return hostFromOs();
  }
}
