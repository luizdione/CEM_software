import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeInventory } from './analyze.js';
import type { AnalyzeInput } from './analyze.js';
import type {
  Alert,
  Inventory,
  GpuDevice,
  GpuSection,
  InventoryHost,
  PerformanceConfig,
  CondaSection,
  WslSection,
  DockerSection,
} from './types.js';

// Golden fixture: a real (sanitized) inventario.json with `alertas` produced
// by the Python collector's `analisar()`. Loaded via readFileSync so it works
// under plain ESM without import-assertion syntax.
const fixturePath = new URL('./__fixtures__/inventario.sample.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Inventory;

/** Collapse an alert to the identity triple compared against the fixture. */
const tuple = (a: Alert): string => `${a.nivel}|${a.area}|${a.titulo}`;

function countByLevel(alerts: readonly Alert[]): Record<string, number> {
  return alerts.reduce<Record<string, number>>((acc, a) => {
    acc[a.nivel] = (acc[a.nivel] ?? 0) + 1;
    return acc;
  }, {});
}

describe('analyzeInventory (golden fixture)', () => {
  it('reproduces the alert set the Python collector recorded for this machine snapshot', () => {
    const input: AnalyzeInput = {
      host: fixture.host,
      gpu: fixture.gpu,
      config_desempenho: fixture.config_desempenho,
      conda: fixture.conda,
      wsl: fixture.wsl,
      docker: fixture.docker,
    };
    const result = analyzeInventory(input);

    // (a) counts by level match exactly: fixture has 3 aviso, 3 info, 1 ok, 0 critico.
    expect(countByLevel(result)).toEqual(countByLevel(fixture.alertas));

    // (b) same set of (nivel, area, titulo) identities, order-independent (sanitization
    // may have touched wording elsewhere, so we don't compare full text).
    expect(new Set(result.map(tuple))).toEqual(new Set(fixture.alertas.map(tuple)));
  });
});

// ---------------------------------------------------------------------------
// Minimal valid fixtures for synthetic unit tests below.
// ---------------------------------------------------------------------------

function makeGpuDevice(overrides: Partial<GpuDevice> = {}): GpuDevice {
  return {
    indice: '0',
    nome: 'Test GPU',
    driver: '1.0',
    vbios: '1.0',
    uuid: 'GPU-test',
    vram_total_mib: 12288,
    vram_usada_mib: 0,
    vram_livre_mib: 12288,
    vram_reservada_mib: 0,
    vram_uso_pct: 0,
    util_gpu_pct: 0,
    util_mem_pct: 0,
    temperatura_c: 40,
    fan_pct: 0,
    potencia_w: 20,
    potencia_limite_w: 170,
    potencia_limite_max_w: 187,
    potencia_limite_padrao_w: 170,
    clock_sm_mhz: 2000,
    clock_sm_max_mhz: 2100,
    clock_mem_mhz: 7000,
    clock_mem_max_mhz: 7501,
    pcie_gen: '3/3',
    pcie_largura: 'x16/x16',
    modo_computacao: 'Default',
    modo_persistencia: 'Disabled',
    display_ativo: 'Disabled',
    ...overrides,
  };
}

function makeGpuSection(gpus: readonly GpuDevice[], overrides: Partial<GpuSection> = {}): GpuSection {
  return {
    disponivel: true,
    gpus,
    processos: [],
    avisos: [],
    memoria_por_processo: [],
    sysmem_fallback_gb: 0,
    ...overrides,
  };
}

function makeHost(overrides: Partial<InventoryHost> = {}): InventoryHost {
  return {
    hostname: 'test-host',
    os: 'Windows 11',
    os_versao: '10.0',
    arquitetura: 'AMD64',
    discos: [],
    discos_fisicos: [],
    pentes_ram: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<PerformanceConfig> = {}): PerformanceConfig {
  return {
    windows: {
      plano_energia: null,
      plano_alto_desempenho: true,
      hags_hwschmode: null,
      hags_ativo: null,
      hags_indeterminado: false,
      tdrlevel: null,
      tdrdelay: null,
      tdrddidelay: null,
      pagefile: [],
      vbs_status: null,
      vbs_ativo: false,
      antivirus: [],
    },
    nvidia: {},
    variaveis_ambiente: {},
    recomendacoes_leitura: [],
    env_persistente_usuario: {},
    env_persistente_maquina: {},
    ...overrides,
  };
}

const emptyConda: CondaSection = { disponivel: false, instalacoes: [], condarc: null, ambientes: [] };
const emptyWsl: WslSection = { disponivel: false, avisos: [], versao: [], wslconfig: null, distros: [] };
const emptyDocker: DockerSection = { disponivel: false, imagens: [], containers: [], volumes: [] };

function baseInput(overrides: Partial<AnalyzeInput> = {}): AnalyzeInput {
  return {
    host: makeHost(),
    gpu: makeGpuSection([]),
    config_desempenho: makeConfig(),
    conda: emptyConda,
    wsl: emptyWsl,
    docker: emptyDocker,
    ...overrides,
  };
}

describe('analyzeInventory (synthetic threshold cases)', () => {
  it('flags VRAM usage >= 92% as a critical GPU alert', () => {
    const gpu = makeGpuSection([
      makeGpuDevice({ vram_uso_pct: 93, vram_usada_mib: 11428, vram_total_mib: 12288 }),
    ]);
    const result = analyzeInventory(baseInput({ gpu }));

    const critical = result.filter((a) => a.nivel === 'critico' && a.area === 'GPU');
    expect(critical).toHaveLength(1);
    expect(critical[0]?.titulo).toContain('VRAM em 93');
  });

  it('flags a disk above 90% usage as a warning', () => {
    const host = makeHost({
      discos: [{ unidade: 'D:', rotulo: null, fs: 'NTFS', total_gb: 1000, livre_gb: 50, uso_pct: 95 }],
    });
    const result = analyzeInventory(baseInput({ host }));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ nivel: 'aviso', area: 'Armazenamento', titulo: 'Disco D: em 95.0%' });
  });

  it('flags sysmem fallback >= 0.5 GB as a critical GPU alert', () => {
    const gpu = makeGpuSection([makeGpuDevice()], {
      sysmem_fallback_gb: 0.6,
      memoria_por_processo: [{ pid: '1234', vram_gb: 1.0, ram_gb: 0.6, total_gb: 1.6, nome: 'test.exe' }],
    });
    const result = analyzeInventory(baseInput({ gpu }));

    const critical = result.filter((a) => a.nivel === 'critico' && a.area === 'GPU');
    expect(critical.some((a) => a.titulo.includes('sysmem fallback'))).toBe(true);
  });
});
