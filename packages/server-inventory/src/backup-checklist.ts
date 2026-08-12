/**
 * Backup readiness checklist. 1:1 port of `avaliar_backup()` from the legacy
 * Python collector (`coletar_inventario.py`): same items, same wording, same
 * criticality. Never throws: a collapsed section (see {@link isSectionError})
 * is treated as empty/absent, mirroring Python's `inv.get(nome, {})`.
 */
import type {
  BackupCheckItem,
  BackupCriticality,
  Section,
  InventoryHost,
  CondaSection,
  WslSection,
  DockerSection,
  ProgramsSection,
} from './types.js';
import { isSectionError } from './types.js';

export interface BackupChecklistInput {
  readonly host: Section<InventoryHost>;
  readonly conda: Section<CondaSection>;
  readonly wsl: Section<WslSection>;
  readonly docker: Section<DockerSection>;
  readonly programas: Section<ProgramsSection>;
}

/** Unwrap a Section to its data, or undefined when collection failed entirely. */
function ok<T>(section: Section<T>): T | undefined {
  return isSectionError(section) ? undefined : section;
}

export function buildBackupChecklist(inv: BackupChecklistInput): BackupCheckItem[] {
  const items: BackupCheckItem[] = [];

  const add = (item: string, ok: boolean, detalhe: string, criticidade: BackupCriticality = 'media'): void => {
    items.push({ item, ok, detalhe, criticidade });
  };

  const conda = ok(inv.conda);
  const wsl = ok(inv.wsl);
  const docker = ok(inv.docker);
  const programas = ok(inv.programas);
  const host = ok(inv.host);

  const nEnvs = conda?.ambientes?.length ?? 0;
  add(
    'Ambientes conda exportados (.yml)',
    false,
    `${nEnvs} ambientes detectados. Rode backup_servidor.ps1 para exportar ` +
      'environment.yml + pip freeze de cada um.',
    'alta',
  );

  const distrosUsuario = (wsl?.distros ?? []).filter(
    (d) => !d.nome.toLowerCase().startsWith('docker-desktop'),
  );
  add(
    'Distros WSL exportadas (.tar)',
    false,
    `${distrosUsuario.length} distro(s) de usuario. 'wsl --export' gera um tar ` +
      "restauravel com 'wsl --import'.",
    'alta',
  );

  const imagens = docker?.imagens ?? [];
  add(
    'Imagens Docker registradas',
    imagens.length > 0,
    `${imagens.length} imagens. Salve a lista e os Dockerfiles; ` +
      "'docker save' so para imagens sem origem em registry.",
    'media',
  );

  const wingetDisponivel = programas?.winget_disponivel ?? false;
  add(
    'Lista de programas / winget export',
    wingetDisponivel,
    wingetDisponivel
      ? 'winget disponivel: da para gerar um manifesto reinstalavel.'
      : 'winget ausente: a reinstalacao sera manual.',
    'media',
  );

  add(
    'Chaves de registro de desempenho (HAGS/TDR)',
    true,
    'Coletadas neste inventario; o script de backup as exporta em .reg.',
    'baixa',
  );

  add(
    'Imagem completa do disco (bare metal)',
    false,
    'Inventario + scripts recriam o AMBIENTE, nao um clone bit-a-bit. ' +
      'Para restaurar identico, use imagem de disco (wbadmin/Macrium/Veeam) ' +
      'num destino externo.',
    'alta',
  );

  const discos = host?.discos ?? [];
  const critico = discos.filter((d) => (d.uso_pct ?? 0) > 90);
  add(
    'Espaco livre para o backup',
    critico.length === 0,
    critico.length > 0
      ? `Unidades acima de 90%: [${critico.map((d) => `'${d.unidade}'`).join(', ')}]`
      : 'Nenhuma unidade acima de 90%.',
    'media',
  );

  return items;
}
