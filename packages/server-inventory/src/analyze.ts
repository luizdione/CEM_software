/**
 * Threshold-based alert analysis. 1:1 port of `analisar()` from the legacy
 * Python collector (`coletar_inventario.py`), including exact thresholds,
 * Portuguese alert texts and the final severity ordering. Never throws: a
 * collapsed section (see {@link isSectionError}) is treated as empty/absent,
 * mirroring Python's `inv.get(nome, {})` default-dict behavior.
 */
import type {
  Alert,
  AlertLevel,
  Section,
  InventoryHost,
  GpuSection,
  GpuProcessMemory,
  PerformanceConfig,
  CondaSection,
  WslSection,
  DockerSection,
} from './types.js';
import { isSectionError } from './types.js';

export interface AnalyzeInput {
  readonly host: Section<InventoryHost>;
  readonly gpu: Section<GpuSection>;
  readonly config_desempenho: Section<PerformanceConfig>;
  readonly conda: Section<CondaSection>;
  readonly wsl: Section<WslSection>;
  readonly docker: Section<DockerSection>;
}

/** Unwrap a Section to its data, or undefined when collection failed entirely. */
function ok<T>(section: Section<T>): T | undefined {
  return isSectionError(section) ? undefined : section;
}

/**
 * Mirror Python's `str(float)`: a whole-number float always shows one decimal
 * (e.g. `90` -> `"90.0"`). Needed for the handful of f-strings in the source
 * that interpolate a rounded float with no explicit format spec (`{uso}%`,
 * `{ram}%`, `{d['uso_pct']}%`, `{d['livre_gb']} GB`).
 */
function pyFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/** `x.toFixed(0)`-equivalent to Python's `f"{x:.0f}"`. */
const f0 = (n: number): string => n.toFixed(0);
/** `x.toFixed(2)`-equivalent to Python's `f"{x:.2f}"`. */
const f2 = (n: number): string => n.toFixed(2);

export function analyzeInventory(inv: AnalyzeInput): Alert[] {
  const alerts: Alert[] = [];

  const push = (
    nivel: AlertLevel,
    area: string,
    titulo: string,
    detalhe: string,
    acao: string | null = null,
    reparo: string | null = null,
  ): void => {
    alerts.push({ nivel, area, titulo, detalhe, acao, reparo });
  };

  const host = ok(inv.host);
  const gpu = ok(inv.gpu);
  const cfg = ok(inv.config_desempenho);
  const conda = ok(inv.conda);
  const wsl = ok(inv.wsl);
  const docker = ok(inv.docker);

  const gpus = gpu?.gpus ?? [];
  const fallback = gpu?.sysmem_fallback_gb ?? 0;

  // --- GPU -----------------------------------------------------------------
  for (const g of gpus) {
    const uso = g.vram_uso_pct;
    if (uso != null && uso >= 92) {
      const usada = g.vram_usada_mib ?? 0;
      const total = g.vram_total_mib ?? 0;
      push(
        'critico',
        'GPU',
        `VRAM em ${pyFloat(uso)}%`,
        `${f0(usada)} de ${f0(total)} MiB em uso. ` +
          'Acima de ~92% o alocador do PyTorch fragmenta e pode cair em ' +
          'sysmem fallback (RAM via PCIe), o que derruba o throughput.',
        'Feche apps graficos, use PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True ' +
          'e reduza o lote/amostras paralelas.',
        'liberar_vram',
      );
    }

    if (g.display_ativo === 'Enabled') {
      const nGraf = gpu?.n_processos_graficos ?? 0;
      push(
        'aviso',
        'GPU',
        'GPU compartilhada com o desktop',
        `A placa tambem desenha a tela e ha ${nGraf} processos graficos ` +
          'com contexto na GPU (navegadores, Electron, overlays). Cada um ' +
          'reserva VRAM que deixa de estar disponivel para o job CUDA.',
        'Desative aceleracao por hardware nos apps que ficam abertos e ' +
          'feche navegadores durante rodadas longas.',
        'liberar_vram',
      );
    }

    // When VRAM already spilled to RAM, the fallback alert below explains the
    // cause; repeating it here would just duplicate the same diagnosis.
    const pot = g.potencia_w;
    const lim = g.potencia_limite_w;
    const semFallback = fallback < 0.5;
    const utilGpu = g.util_gpu_pct ?? 0;
    if (semFallback && pot && lim && utilGpu >= 95 && pot < 0.65 * lim) {
      push(
        'info',
        'GPU',
        'Consumo abaixo do limite com GPU saturada',
        `${f0(pot)} W de ${f0(lim)} W a ${f0(utilGpu)}% de uso. ` +
          'Uso alto com potencia baixa costuma indicar carga limitada por ' +
          'memoria ou latencia, nao por calculo.',
        'Ganho vem de kernels melhores e menos trafego de VRAM, nao de overclock.',
      );
    }

    const clock = g.clock_sm_mhz;
    const clockMax = g.clock_sm_max_mhz;
    if (clock && clockMax && clock < 0.75 * clockMax) {
      push(
        'aviso',
        'GPU',
        'Clock bem abaixo do maximo',
        `SM em ${f0(clock)} MHz de ${f0(clockMax)} MHz.`,
        'Verifique temperatura, ventilacao e os motivos de throttle.',
      );
    }

    const temp = g.temperatura_c;
    if (temp && temp >= 80) {
      push(
        'aviso',
        'GPU',
        `Temperatura em ${f0(temp)} C`,
        'Acima de ~83 C a RTX 3060 comeca a reduzir clock sozinha.',
        'Melhore o fluxo de ar do gabinete e a curva de ventoinha.',
      );
    }

    const pcie = g.pcie_gen ?? '';
    if (pcie.includes('/')) {
      const [atual = '', maximo = ''] = pcie.split('/');
      if (/^\d+$/.test(atual) && /^\d+$/.test(maximo) && Number(atual) < Number(maximo)) {
        push(
          'info',
          'GPU',
          `PCIe em Gen${atual} (maximo Gen${maximo})`,
          'O link cai de geracao quando ocioso; so preocupa se ficar ' +
            'assim sob carga com muita transferencia host-device.',
        );
      }
    }
  }

  // The most expensive finding is the most invisible one: VRAM spilling into RAM.
  if (fallback >= 0.5) {
    const piores: readonly GpuProcessMemory[] = (gpu?.memoria_por_processo ?? []).filter(
      (p) => (p.ram_gb ?? 0) >= 0.5,
    );
    const detalheProc = piores
      .slice(0, 3)
      .map(
        (p) =>
          `PID ${p.pid} (${p.nome ?? '?'}): ${f2(p.vram_gb)} GB em VRAM + ${f2(p.ram_gb)} GB em RAM`,
      )
      .join('; ');
    push(
      'critico',
      'GPU',
      `${f2(fallback)} GB de memoria de GPU estao na RAM (sysmem fallback)`,
      'A demanda excede a VRAM da placa e o driver passou a atender o excedente ' +
        `pela RAM do host, atraves do barramento PCIe. ${detalheProc}. ` +
        'A banda da VRAM e da ordem de centenas de GB/s; a do PCIe, de dezenas. ' +
        'O processo continua rodando, so que muito mais devagar -- e o nvidia-smi ' +
        'nao mostra isso.',
      "Reduza a demanda de memoria do job (menos amostras em paralelo, menos " +
        'ciclos de reciclagem, entrada menor) ate caber na VRAM, e libere a ' +
        "VRAM presa em aplicativos graficos. Se preferir falhar rapido a " +
        "degradar, ajuste 'CUDA - Sysmem Fallback Policy' no painel da NVIDIA.",
      'liberar_vram',
    );
  }

  // High utilization with low power draw is the signature of a memory-bound load.
  for (const g of gpus) {
    const pot = g.potencia_w;
    const lim = g.potencia_limite_w;
    const util = g.util_gpu_pct;
    if (pot && lim && util && util >= 95 && pot < 0.6 * lim && fallback >= 0.5) {
      push(
        'aviso',
        'GPU',
        'Uso em 100% sem consumo correspondente',
        `${f0(util)}% de utilizacao com apenas ${f0(pot)} W de ${f0(lim)} W. ` +
          'A placa esta ocupada movendo dados, nao calculando: os nucleos ' +
          'passam a maior parte do tempo esperando memoria.',
        'Resolver o transbordo de VRAM acima tende a elevar o consumo e ' +
          'reduzir o tempo de execucao ao mesmo tempo.',
      );
    }
  }

  const ativos = gpu?.throttle_ativo ?? [];
  if (ativos.length > 0) {
    push('aviso', 'GPU', 'Reducao de clock ativa', `Motivos ativos: ${ativos.join(', ')}.`);
  }

  // --- Windows / sistema -----------------------------------------------------
  const win = cfg?.windows;
  if (win?.hags_ativo === false) {
    push(
      'info',
      'Sistema',
      'Agendamento de GPU por hardware desligado',
      'HwSchMode != 2. Com HAGS ligado, a GPU gerencia a propria fila de ' +
        'trabalho e reduz latencia de submissao em cargas com muitos kernels curtos.',
      'Configuracoes > Tela > Graficos > Padroes > Agendamento de GPU acelerado ' +
        'por hardware. Exige reinicio.',
    );
  } else if (win?.hags_indeterminado) {
    push(
      'info',
      'Sistema',
      'Agendamento de GPU por hardware nao determinado',
      'A chave HwSchMode nao existe no registro, ou seja, a opcao nunca foi ' +
        'alterada e vale o padrao do driver. Nao da para afirmar pelo registro ' +
        'se esta ligada.',
      'Confira em Configuracoes > Tela > Graficos > Configuracoes graficas ' +
        'padrao. Se ja estiver ligada, nao ha o que fazer.',
    );
  }

  if (win?.plano_alto_desempenho === false) {
    push(
      'info',
      'Sistema',
      'Plano de energia nao e de alto desempenho',
      `Plano ativo: ${win?.plano_energia ?? 'desconhecido'}. ` +
        'No plano equilibrado o Windows reduz clock da CPU, o que estrangula ' +
        'as etapas de pre-processamento de um pipeline.',
      'powercfg /setactive SCHEME_MIN',
      'plano_energia',
    );
  }

  if (win?.vbs_ativo) {
    push(
      'info',
      'Sistema',
      'Seguranca baseada em virtualizacao (VBS) ativa',
      'VBS/HVCI custa alguns por cento de CPU e I/O. Mantenha se a maquina ' +
        'guarda dado sensivel; e um custo consciente, nao um defeito.',
    );
  }

  const ram = host?.ram_uso_pct;
  if (ram && ram > 85) {
    push(
      'aviso',
      'Sistema',
      `RAM em ${pyFloat(ram)}%`,
      'Pouca RAM livre faz o Windows paginar; em pipelines com MSA e ' +
        'estruturas grandes isso vira gargalo de disco.',
      'Feche aplicativos que ficam abertos sem uso.',
      'liberar_vram',
    );
  }

  for (const d of host?.discos ?? []) {
    if ((d.uso_pct ?? 0) > 90) {
      push(
        'aviso',
        'Armazenamento',
        `Disco ${d.unidade} em ${pyFloat(d.uso_pct ?? 0)}%`,
        `Restam ${pyFloat(d.livre_gb ?? 0)} GB.`,
        'Libere espaco: cache de modelos, imagens Docker antigas e ' +
          'saidas intermediarias.',
      );
    }
  }

  // --- ambientes ---------------------------------------------------------
  const cudaDriver = gpu?.cuda_driver;
  for (const env of conda?.ambientes ?? []) {
    if (env.torch_somente_cpu) {
      push(
        'aviso',
        'Ambiente',
        `'${env.nome}' tem PyTorch somente CPU`,
        `torch ${env.torch} sem build CUDA.`,
        'Reinstale a partir do indice CUDA se este ambiente for usar GPU.',
      );
    }

    if (env.torch_cuda && cudaDriver) {
      const torchCudaNum = Number(env.torch_cuda);
      const cudaDriverNum = Number(cudaDriver);
      if (!Number.isNaN(torchCudaNum) && !Number.isNaN(cudaDriverNum) && torchCudaNum > cudaDriverNum) {
        push(
          'critico',
          'Ambiente',
          `'${env.nome}': CUDA do torch acima do driver`,
          `torch compilado para CUDA ${env.torch_cuda}, driver ` + `suporta ate ${cudaDriver}.`,
          'Atualize o driver ou reinstale o torch numa build compativel.',
        );
      }
    }
  }

  // --- WSL ---------------------------------------------------------------
  if (wsl?.disponivel && wsl.wslconfig === null) {
    push(
      'info',
      'WSL',
      'Sem ~/.wslconfig',
      'A VM do WSL2 pode reservar ate metade da RAM do host, disputando ' +
        'memoria com jobs que rodam no Windows.',
      'Crie ~/.wslconfig fixando memory e processors.',
      'wslconfig',
    );
  }

  for (const d of wsl?.distros ?? []) {
    if (d.gpu_ok === false && d.distro_nome) {
      push(
        'aviso',
        'WSL',
        `Distro '${d.nome}' sem acesso a GPU`,
        'nvidia-smi nao responde dentro da distro.',
        'Confirme o driver do Windows com suporte WSL e o pacote ' +
          'nvidia-container-toolkit se for usar containers com GPU.',
      );
    }
  }

  // --- Docker ------------------------------------------------------------
  if (docker?.disponivel && docker.runtime_nvidia) {
    push(
      'ok',
      'Docker',
      'Runtime NVIDIA ja registrado',
      "O daemon lista o runtime 'nvidia'. Containers com --gpus all " +
        'enxergam a placa; nao ha o que instalar.',
    );
  } else if (docker?.disponivel) {
    push(
      'aviso',
      'Docker',
      'Sem runtime NVIDIA',
      "O daemon nao lista o runtime 'nvidia'; containers nao verao a GPU.",
    );
  }

  const ordem: Record<AlertLevel, number> = { critico: 0, aviso: 1, info: 2, ok: 3 };
  alerts.sort((a, b) => (ordem[a.nivel] ?? 9) - (ordem[b.nivel] ?? 9));
  return alerts;
}
