/**
 * Type contract for the machine inventory.
 *
 * Field names are kept in Portuguese snake_case, IDENTICAL to the JSON emitted
 * by the original `lupa_servidor` Python collector (`inventario.json`). This is
 * deliberate: it lets the same JSON serve as a golden test fixture and lets
 * {@link loadInventoryFromFile} read a file produced by EITHER the native TS
 * collector or the legacy Python tool without translation. The UI layer (React)
 * is what renders English labels — the data contract stays faithful.
 */

/** A section collapses to this shape when its collector failed entirely. */
export interface InventoryError {
  readonly erro: string;
}

/** A top-level section that may have failed collection. */
export type Section<T> = T | InventoryError;

/** True when a section collapsed to an {@link InventoryError}. */
export function isSectionError<T>(section: Section<T>): section is InventoryError {
  return (
    typeof section === 'object' &&
    section !== null &&
    'erro' in section &&
    !('disponivel' in section)
  );
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

export interface InventoryMeta {
  readonly gerado_em: string;
  readonly versao_coletor: string;
  readonly raizes_scripts: readonly string[];
  readonly wsl_inspecionado: boolean;
}

// ---------------------------------------------------------------------------
// host
// ---------------------------------------------------------------------------

export interface CpuInfo {
  readonly modelo: string;
  readonly nucleos_fisicos: number | null;
  readonly nucleos_logicos: number | null;
  readonly clock_max_mhz: number | null;
  readonly clock_atual_mhz: number | null;
  readonly cache_l3_kb: number | null;
  readonly virtualizacao_firmware: boolean | null;
}

export interface DiskVolume {
  readonly unidade: string | null;
  readonly rotulo: string | null;
  readonly fs: string | null;
  readonly total_gb: number | null;
  readonly livre_gb: number | null;
  readonly uso_pct: number | null;
}

export interface PhysicalDisk {
  readonly modelo: string | null;
  readonly tipo: string | null;
  readonly tamanho_gb: number | null;
  readonly barramento: string | null;
  readonly saude: string | null;
}

export interface RamStick {
  readonly fabricante: string;
  readonly capacidade_gb: number | null;
  readonly velocidade_mhz: number | null;
  readonly clock_configurado_mhz: number | null;
}

/**
 * Machine host info. NOTE: intentionally named `InventoryHost`, not `HostInfo`,
 * to avoid colliding with `@cem/core`'s much smaller `HostInfo` type.
 */
export interface InventoryHost {
  readonly hostname: string;
  readonly os: string;
  readonly os_versao: string;
  readonly arquitetura: string;
  /** Only present in files produced by the legacy Python collector. */
  readonly python_coletor?: string;
  readonly os_nome?: string;
  readonly os_build?: string;
  readonly ram_total_gb?: number | null;
  readonly ram_livre_gb?: number | null;
  readonly ram_uso_pct?: number | null;
  readonly ultimo_boot?: string | null;
  readonly placa_mae?: string | null;
  readonly cpu?: CpuInfo;
  readonly discos: readonly DiskVolume[];
  readonly discos_fisicos: readonly PhysicalDisk[];
  readonly pentes_ram: readonly RamStick[];
}

// ---------------------------------------------------------------------------
// gpu
// ---------------------------------------------------------------------------

export interface GpuDevice {
  readonly indice: string;
  readonly nome: string;
  readonly driver: string;
  readonly vbios: string;
  readonly uuid: string;
  readonly vram_total_mib: number | null;
  readonly vram_usada_mib: number | null;
  readonly vram_livre_mib: number | null;
  readonly vram_reservada_mib: number | null;
  readonly vram_uso_pct: number | null;
  readonly util_gpu_pct: number | null;
  readonly util_mem_pct: number | null;
  readonly temperatura_c: number | null;
  readonly fan_pct: number | null;
  readonly potencia_w: number | null;
  readonly potencia_limite_w: number | null;
  readonly potencia_limite_max_w: number | null;
  readonly potencia_limite_padrao_w: number | null;
  readonly clock_sm_mhz: number | null;
  readonly clock_sm_max_mhz: number | null;
  readonly clock_mem_mhz: number | null;
  readonly clock_mem_max_mhz: number | null;
  readonly pcie_gen: string;
  readonly pcie_largura: string;
  readonly modo_computacao: string;
  readonly modo_persistencia: string;
  readonly display_ativo: string;
}

export interface GpuComputeProcess {
  readonly pid: string;
  readonly nome: string;
  readonly vram_mib?: string | null;
  readonly tipo: 'compute';
  readonly linha_comando?: string | null;
  readonly iniciado_em?: string | null;
  readonly ram_gb?: number | null;
}

export interface GpuGraphicsProcess {
  readonly pid: string;
  readonly tipo: string;
  readonly nome: string;
  readonly vram_mib: string;
}

/** Per-process memory split: real VRAM vs. VRAM spilled to system RAM (PCIe). */
export interface GpuProcessMemory {
  readonly pid: string;
  readonly vram_gb: number;
  readonly ram_gb: number;
  readonly total_gb: number;
  readonly nome?: string;
  readonly linha_comando?: string | null;
}

export interface GpuSection {
  readonly disponivel: boolean;
  readonly erro?: string;
  readonly gpus: readonly GpuDevice[];
  readonly processos: readonly GpuComputeProcess[];
  readonly avisos: readonly string[];
  readonly motivos_throttle?: Record<string, string>;
  readonly throttle_ativo?: readonly string[];
  readonly processos_todos?: readonly GpuGraphicsProcess[];
  readonly n_processos_graficos?: number;
  readonly memoria_por_processo: readonly GpuProcessMemory[];
  /** Total VRAM (GB) that overflowed into system RAM across compute processes. */
  readonly sysmem_fallback_gb: number;
  /** Max CUDA runtime the installed driver supports (when detectable). */
  readonly cuda_driver?: string;
}

// ---------------------------------------------------------------------------
// config_desempenho
// ---------------------------------------------------------------------------

export interface PageFileUsage {
  readonly Name: string;
  readonly AllocatedBaseSize: number;
  readonly CurrentUsage: number;
  readonly PeakUsage: number;
}

export interface AntivirusProduct {
  readonly nome: string;
  readonly estado: number | null;
}

export interface WindowsPerfConfig {
  readonly plano_energia: string | null;
  readonly plano_alto_desempenho: boolean;
  readonly hags_hwschmode: number | null;
  readonly hags_ativo: boolean | null;
  readonly hags_indeterminado: boolean;
  readonly tdrlevel: string | number | null;
  readonly tdrdelay: string | number | null;
  readonly tdrddidelay: string | number | null;
  readonly pagefile: readonly PageFileUsage[];
  readonly vbs_status: number | null;
  readonly vbs_ativo: boolean;
  readonly antivirus: readonly AntivirusProduct[];
}

export interface PerformanceConfig {
  readonly windows: WindowsPerfConfig;
  /** Raw NVIDIA registry dump (NVTweak); shape is provider-specific, kept opaque. */
  readonly nvidia: { readonly nvtweak?: unknown };
  readonly variaveis_ambiente: Record<string, string>;
  readonly recomendacoes_leitura: readonly string[];
  readonly env_persistente_usuario: Record<string, string>;
  readonly env_persistente_maquina: Record<string, string>;
}

// ---------------------------------------------------------------------------
// conda
// ---------------------------------------------------------------------------

export interface CondaHighlight {
  readonly versao: string;
  readonly origem: string;
  readonly categoria: string;
}

export interface CondaEnv {
  readonly nome: string;
  readonly caminho: string;
  readonly python: string | null;
  readonly total_pacotes: number;
  readonly n_conda: number;
  readonly n_pip: number;
  readonly destaques: Record<string, CondaHighlight>;
  readonly pacotes: Record<string, string>;
  readonly torch?: string | null;
  readonly torch_cuda?: string | null;
  readonly torch_somente_cpu?: boolean;
  readonly tamanho_gb?: number | null;
  readonly tamanho_truncado?: boolean;
}

export interface CondaRc {
  readonly caminho: string;
  readonly conteudo: string;
}

export interface CondaSection {
  readonly disponivel: boolean;
  readonly erro?: string;
  readonly instalacoes: readonly string[];
  readonly condarc: CondaRc | null;
  readonly ambientes: readonly CondaEnv[];
}

// ---------------------------------------------------------------------------
// wsl
// ---------------------------------------------------------------------------

export interface WslDistro {
  readonly nome: string;
  readonly estado: string;
  readonly versao_wsl: string;
  readonly padrao: boolean;
  readonly caminho_base?: string | null;
  readonly vhdx?: string | null;
  readonly vhdx_gb?: number | null;
  readonly estava_parada_antes_da_coleta?: boolean;
  // Fields below only populated when internal inspection runs (inspect: true).
  readonly distro_nome?: string;
  readonly kernel?: string;
  readonly cpus?: number | string | null;
  readonly ram_gb?: number | null;
  readonly gpu_visivel?: boolean;
  readonly gpu_ok?: boolean;
  readonly nvcc?: string | null;
  readonly conda?: string | null;
  readonly python?: string | null;
  readonly pacotes_pip?: readonly string[];
  readonly pacotes_apt?: readonly string[];
  readonly disco?: string | null;
  readonly erro_inspecao?: string;
}

export interface WslConfig {
  readonly caminho: string;
  readonly conteudo: string;
}

export interface WslSection {
  readonly disponivel: boolean;
  readonly erro?: string;
  readonly avisos: readonly string[];
  readonly versao: readonly string[];
  readonly wslconfig: WslConfig | null;
  readonly distros: readonly WslDistro[];
}

// ---------------------------------------------------------------------------
// docker
// ---------------------------------------------------------------------------

export interface DockerImage {
  readonly repositorio: string;
  readonly tag: string;
  readonly tamanho: string;
  readonly id: string;
  readonly criada: string;
}

export interface DockerContainer {
  readonly nome: string;
  readonly imagem: string;
  readonly status: string;
  readonly portas: string;
}

export interface DockerVolume {
  readonly nome: string;
  readonly driver: string;
}

export interface DockerSection {
  readonly disponivel: boolean;
  readonly erro?: string;
  readonly versao_cliente?: string | null;
  readonly versao_servidor?: string | null;
  readonly runtimes?: readonly string[];
  readonly runtime_nvidia?: boolean;
  readonly storage_driver?: string | null;
  readonly root_dir?: string | null;
  readonly cpus_visiveis?: number | string | null;
  readonly ram_visivel_gb?: number | null;
  readonly n_imagens?: number;
  readonly n_containers?: number;
  readonly imagens: readonly DockerImage[];
  readonly containers: readonly DockerContainer[];
  readonly volumes: readonly DockerVolume[];
}

// ---------------------------------------------------------------------------
// programas
// ---------------------------------------------------------------------------

export interface Program {
  readonly nome: string;
  readonly versao: string | null;
  readonly fabricante: string | null;
  readonly instalado_em: string | null;
  readonly tamanho_mb: number | null;
}

export interface ProgramsSection {
  readonly total: number;
  readonly erro?: string;
  readonly relevantes: readonly Program[];
  readonly todos: readonly Program[];
  readonly winget_disponivel: boolean;
  readonly winget_versao?: string | null;
}

// ---------------------------------------------------------------------------
// ferramentas
// ---------------------------------------------------------------------------

export interface ToolInfo {
  readonly caminho: string | null;
  readonly versao?: string | null;
}

export interface ToolsSection {
  readonly cli: Record<string, ToolInfo>;
  readonly erro?: string;
}

// ---------------------------------------------------------------------------
// scripts_config
// ---------------------------------------------------------------------------

export interface ScriptConfigEntry {
  readonly caminho: string;
  readonly nome: string;
  readonly tamanho_kb: number;
  readonly modificado: string;
  readonly marcadores: readonly string[];
  readonly mexe_em_gpu: boolean;
}

// ---------------------------------------------------------------------------
// alertas
// ---------------------------------------------------------------------------

export type AlertLevel = 'critico' | 'aviso' | 'info' | 'ok';

export interface Alert {
  readonly nivel: AlertLevel;
  readonly area: string;
  readonly titulo: string;
  readonly detalhe: string;
  readonly acao?: string | null;
  /**
   * Repair-action id from the original tool (e.g. `liberar_vram`,
   * `plano_energia`, `wslconfig`). Preserved for schema fidelity only — CEM is
   * read-only and wires NO action to it.
   */
  readonly reparo?: string | null;
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------

export type BackupCriticality = 'alta' | 'media' | 'baixa';

export interface BackupCheckItem {
  readonly item: string;
  readonly ok: boolean;
  readonly detalhe: string;
  readonly criticidade: BackupCriticality;
}

// ---------------------------------------------------------------------------
// top-level
// ---------------------------------------------------------------------------

export interface Inventory {
  readonly meta: InventoryMeta;
  readonly host: Section<InventoryHost>;
  readonly gpu: Section<GpuSection>;
  readonly config_desempenho: Section<PerformanceConfig>;
  readonly conda: Section<CondaSection>;
  readonly wsl: Section<WslSection>;
  readonly docker: Section<DockerSection>;
  readonly programas: Section<ProgramsSection>;
  readonly ferramentas: Section<ToolsSection>;
  readonly scripts_config: readonly ScriptConfigEntry[];
  readonly alertas: readonly Alert[];
  readonly backup: readonly BackupCheckItem[];
}
