import { useEffect, useState } from 'react';
import type {
  Inventory,
  GpuSection,
  InventoryHost,
  CondaSection,
  WslSection,
  DockerSection,
  ProgramsSection,
  ToolsSection,
  Alert,
  ScriptConfigEntry,
  BackupCheckItem,
} from '@cem/server-inventory';
import { isSectionError } from '@cem/server-inventory';
import { cem } from '../cem-api.js';
import { PageHead, Card, StatCard, Badge, Bar, Spinner, EmptyState, useAsync } from '../components/common.js';
import { formatDate, formatNumber } from '../format.js';

type TabId = 'overview' | 'gpu' | 'environments' | 'wsl' | 'docker' | 'software' | 'scripts' | 'backup';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'gpu', label: 'GPU & CPU' },
  { id: 'environments', label: 'Environments' },
  { id: 'wsl', label: 'WSL' },
  { id: 'docker', label: 'Docker' },
  { id: 'software', label: 'Software' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'backup', label: 'Backup' },
];

function computeCounts(inventory: Inventory): Record<TabId, number> {
  return {
    overview: inventory.alertas.length,
    gpu: isSectionError(inventory.gpu) ? 0 : inventory.gpu.gpus.length,
    environments: isSectionError(inventory.conda) ? 0 : inventory.conda.ambientes.length,
    wsl: isSectionError(inventory.wsl) ? 0 : inventory.wsl.distros.length,
    docker: isSectionError(inventory.docker)
      ? 0
      : inventory.docker.imagens.length + inventory.docker.containers.length,
    software: isSectionError(inventory.programas) ? 0 : inventory.programas.relevantes.length,
    scripts: inventory.scripts_config.length,
    backup: inventory.backup.length,
  };
}

export function ServerInventoryView(): JSX.Element {
  const { data: cached } = useAsync(() => cem.inventoryLoad(), []);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [status, setStatus] = useState<string>();
  const [tab, setTab] = useState<TabId>('overview');

  useEffect(() => {
    if (cached) setInventory(cached);
  }, [cached]);

  const collect = async (): Promise<void> => {
    setCollecting(true);
    setStatus(undefined);
    try {
      const result = await cem.inventoryCollect({});
      setInventory(result);
      setStatus(`Collected at ${formatDate(result.meta.gerado_em)}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCollecting(false);
    }
  };

  const loadFile = async (): Promise<void> => {
    setStatus(undefined);
    try {
      const res = await cem.inventoryLoadFile();
      if (res.ok && res.inventory) {
        setInventory(res.inventory);
        setStatus('Inventory loaded from file.');
      } else if (res.reason !== 'cancelled') {
        setStatus(res.reason ?? 'Could not load the selected file.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = inventory ? computeCounts(inventory) : null;

  return (
    <div>
      <PageHead
        title="Server Inventory"
        subtitle="Read-only snapshot of this machine — host, GPU, conda environments, WSL and Docker. Nothing is changed automatically."
        actions={
          <>
            <button className="btn primary" onClick={collect} disabled={collecting}>
              {collecting ? (
                <>
                  <Spinner /> Collecting…
                </>
              ) : (
                'Collect now'
              )}
            </button>
            <button className="btn" onClick={loadFile} disabled={collecting}>
              Load file…
            </button>
          </>
        }
      />

      {status && <div className="note" style={{ marginBottom: 14 }}>{status}</div>}

      {!inventory || !counts ? (
        <EmptyState>
          No inventory collected yet. Click "Collect now" to scan this machine (~30–60s), or load a
          previously exported <span className="mono">inventario.json</span>.
        </EmptyState>
      ) : (
        <>
          <div className="toolbar">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`btn${tab === t.id ? ' primary' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                <Badge>{formatNumber(counts[t.id])}</Badge>
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '0 0 14px' }}>
            Generated at {formatDate(inventory.meta.gerado_em)} · collector v{inventory.meta.versao_coletor}
          </p>

          {tab === 'overview' && <OverviewTab inventory={inventory} />}

          {tab === 'gpu' &&
            (isSectionError(inventory.gpu) ? (
              <Card>
                <SectionUnavailable error={inventory.gpu.erro} />
              </Card>
            ) : (
              <GpuCpuTab gpu={inventory.gpu} host={isSectionError(inventory.host) ? undefined : inventory.host} />
            ))}

          {tab === 'environments' &&
            (isSectionError(inventory.conda) ? (
              <Card>
                <SectionUnavailable error={inventory.conda.erro} />
              </Card>
            ) : (
              <EnvironmentsTab conda={inventory.conda} />
            ))}

          {tab === 'wsl' &&
            (isSectionError(inventory.wsl) ? (
              <Card>
                <SectionUnavailable error={inventory.wsl.erro} />
              </Card>
            ) : (
              <WslTab wsl={inventory.wsl} />
            ))}

          {tab === 'docker' &&
            (isSectionError(inventory.docker) ? (
              <Card>
                <SectionUnavailable error={inventory.docker.erro} />
              </Card>
            ) : (
              <DockerTab docker={inventory.docker} />
            ))}

          {tab === 'software' && <SoftwareTab inventory={inventory} />}

          {tab === 'scripts' && <ScriptsTab scripts={inventory.scripts_config} />}

          {tab === 'backup' && <BackupTab items={inventory.backup} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionUnavailable({ error }: { error: string }): JSX.Element {
  return <div className="note">Section unavailable: {error}</div>;
}

function num(value: number | null | undefined): number {
  return value ?? 0;
}

function fmtPct(value: number | null | undefined): string {
  return value != null ? `${value.toFixed(1)}%` : '—';
}

function AlertRow({ alert }: { alert: Alert }): JSX.Element {
  const tone = alert.nivel === 'critico' ? 'bad' : alert.nivel === 'aviso' ? 'warn' : alert.nivel === 'ok' ? 'good' : undefined;
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone={tone}>{alert.nivel}</Badge>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{alert.area}</span>
        <strong>{alert.titulo}</strong>
      </div>
      <p style={{ color: 'var(--text-dim)', margin: '6px 0 0' }}>{alert.detalhe}</p>
      {alert.acao ? <p style={{ margin: '4px 0 0', fontSize: 12.5 }}>→ {alert.acao}</p> : null}
    </div>
  );
}

function OverviewTab({ inventory }: { inventory: Inventory }): JSX.Element {
  const host: InventoryHost | undefined = isSectionError(inventory.host) ? undefined : inventory.host;
  const gpu: GpuSection | undefined = isSectionError(inventory.gpu) ? undefined : inventory.gpu;
  const condaCount = isSectionError(inventory.conda) ? 0 : inventory.conda.ambientes.length;
  const gpu0 = gpu?.gpus[0];
  const fallback = gpu?.sysmem_fallback_gb ?? 0;

  return (
    <div>
      <div className="grid cols-4">
        <StatCard label="VRAM used" value={fmtPct(gpu0?.vram_uso_pct)} foot={gpu0?.nome ?? 'No GPU data'} />
        <StatCard label="GPU utilization" value={fmtPct(gpu0?.util_gpu_pct)} />
        <StatCard label="RAM used" value={fmtPct(host?.ram_uso_pct)} />
        {fallback >= 0.5 ? (
          <StatCard label="Sysmem fallback" value={`${fallback.toFixed(1)} GB`} foot="VRAM spilled to system RAM" />
        ) : (
          <StatCard label="Conda envs" value={condaCount} />
        )}
      </div>

      <Card style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Alerts</h3>
        {inventory.alertas.length === 0 ? (
          <EmptyState>No alerts — everything looks fine.</EmptyState>
        ) : (
          inventory.alertas.map((a, i) => <AlertRow key={i} alert={a} />)
        )}
      </Card>

      <Card style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: '16px 16px 0' }}>Disks</h3>
        {!host ? (
          <div style={{ padding: 16 }}>
            <SectionUnavailable error={isSectionError(inventory.host) ? inventory.host.erro : 'Host info unavailable'} />
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Drive</th>
                <th>Total (GB)</th>
                <th>Free (GB)</th>
                <th>Used</th>
              </tr>
            </thead>
            <tbody>
              {host.discos.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                    No disk data.
                  </td>
                </tr>
              ) : (
                host.discos.map((d, i) => (
                  <tr key={i}>
                    <td className="mono">{d.unidade ?? '—'}</td>
                    <td>{d.total_gb != null ? d.total_gb.toFixed(1) : '—'}</td>
                    <td>{d.livre_gb != null ? d.livre_gb.toFixed(1) : '—'}</td>
                    <td style={d.uso_pct != null && d.uso_pct >= 90 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
                      {fmtPct(d.uso_pct)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function GpuCpuTab({ gpu, host }: { gpu: GpuSection; host: InventoryHost | undefined }): JSX.Element {
  return (
    <div>
      {gpu.sysmem_fallback_gb >= 0.5 ? (
        <div className="note" style={{ marginBottom: 14, borderLeftColor: 'var(--bad)' }}>
          Sysmem fallback active: {gpu.sysmem_fallback_gb.toFixed(2)} GB of VRAM is spilling into system RAM
          over PCIe — this can badly throttle GPU throughput. See the per-process table below.
        </div>
      ) : null}

      <div className="grid cols-2">
        {gpu.gpus.length === 0 ? (
          <Card>
            <EmptyState>No GPU detected.</EmptyState>
          </Card>
        ) : (
          gpu.gpus.map((g) => (
            <Card key={g.indice}>
              <h3 style={{ marginTop: 0 }}>{g.nome}</h3>
              <Bar label="VRAM %" value={Math.round(num(g.vram_uso_pct))} max={100} />
              <Bar
                label="Clock SM (MHz)"
                value={Math.round(num(g.clock_sm_mhz))}
                max={Math.max(1, Math.round(num(g.clock_sm_max_mhz)))}
              />
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12.5, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                <span>
                  Power: {g.potencia_w != null ? g.potencia_w.toFixed(0) : '—'} / {g.potencia_limite_w != null ? g.potencia_limite_w.toFixed(0) : '—'} W
                </span>
                <span>Temp: {g.temperatura_c != null ? g.temperatura_c.toFixed(0) : '—'} °C</span>
                <span>Driver: {g.driver}</span>
              </div>
            </Card>
          ))
        )}
      </div>

      <Card style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: '16px 16px 0' }}>GPU memory per process</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>PID</th>
              <th>Name</th>
              <th>In VRAM (GB)</th>
              <th>In RAM/PCIe (GB)</th>
            </tr>
          </thead>
          <tbody>
            {gpu.memoria_por_processo.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  No active GPU processes.
                </td>
              </tr>
            ) : (
              gpu.memoria_por_processo.map((p) => (
                <tr key={p.pid}>
                  <td className="mono">{p.pid}</td>
                  <td>{p.nome ?? '—'}</td>
                  <td>{p.vram_gb.toFixed(2)}</td>
                  <td style={p.ram_gb >= 0.5 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{p.ram_gb.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>CPU</h3>
        {!host ? (
          <SectionUnavailable error="Host info unavailable" />
        ) : !host.cpu ? (
          <EmptyState>CPU info not collected.</EmptyState>
        ) : (
          <div style={{ fontSize: 13 }}>
            <div>{host.cpu.modelo}</div>
            <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>
              {host.cpu.nucleos_fisicos ?? '—'} cores / {host.cpu.nucleos_logicos ?? '—'} threads ·{' '}
              {host.cpu.clock_atual_mhz ?? '—'} MHz (max {host.cpu.clock_max_mhz ?? '—'} MHz)
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function EnvironmentsTab({ conda }: { conda: CondaSection }): JSX.Element {
  return (
    <div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Python</th>
              <th>Packages</th>
              <th>Conda</th>
              <th>Pip</th>
              <th>Torch</th>
            </tr>
          </thead>
          <tbody>
            {conda.ambientes.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  No conda environments found.
                </td>
              </tr>
            ) : (
              conda.ambientes.map((e) => (
                <tr key={e.nome}>
                  <td className="mono">{e.nome}</td>
                  <td>{e.python ?? '—'}</td>
                  <td>{e.total_pacotes}</td>
                  <td>{e.n_conda}</td>
                  <td>{e.n_pip}</td>
                  <td>{e.torch ? `${e.torch}${e.torch_cuda ? ` (cuda ${e.torch_cuda})` : ''}` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {conda.condarc ? (
        <Card style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>.condarc</h3>
          <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 8 }}>
            {conda.condarc.caminho}
          </div>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {conda.condarc.conteudo}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}

function WslTab({ wsl }: { wsl: WslSection }): JSX.Element {
  return (
    <div>
      {wsl.avisos.length > 0 ? <div className="note" style={{ marginBottom: 14 }}>{wsl.avisos.join(' ')}</div> : null}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
              <th>WSL version</th>
              <th>Disk (GB)</th>
            </tr>
          </thead>
          <tbody>
            {wsl.distros.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  No WSL distros found.
                </td>
              </tr>
            ) : (
              wsl.distros.map((d) => (
                <tr key={d.nome}>
                  <td className="mono">
                    {d.nome}
                    {d.padrao ? ' (default)' : ''}
                  </td>
                  <td>
                    <Badge tone={d.estado === 'Running' ? 'good' : undefined}>{d.estado}</Badge>
                  </td>
                  <td>{d.versao_wsl}</td>
                  <td>{d.vhdx_gb != null ? d.vhdx_gb.toFixed(1) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {wsl.wslconfig ? (
        <Card style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>.wslconfig</h3>
          <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 8 }}>
            {wsl.wslconfig.caminho}
          </div>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {wsl.wslconfig.conteudo}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}

function DockerTab({ docker }: { docker: DockerSection }): JSX.Element {
  return (
    <div>
      <div className="grid cols-4">
        <StatCard label="Client" value={docker.versao_cliente ?? '—'} />
        <StatCard label="Server" value={docker.versao_servidor ?? '—'} />
        <StatCard label="NVIDIA runtime" value={docker.runtime_nvidia ? <Badge tone="good">yes</Badge> : <Badge>no</Badge>} />
        <StatCard label="Storage driver" value={docker.storage_driver ?? '—'} />
      </div>

      <Card style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: '16px 16px 0' }}>Images ({formatNumber(docker.imagens.length)})</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Tag</th>
              <th>Size</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {docker.imagens.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  No images.
                </td>
              </tr>
            ) : (
              docker.imagens.map((img) => (
                <tr key={img.id}>
                  <td className="mono">{img.repositorio}</td>
                  <td>{img.tag}</td>
                  <td>{img.tamanho}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{img.criada}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: '16px 16px 0' }}>Containers ({formatNumber(docker.containers.length)})</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Image</th>
              <th>Status</th>
              <th>Ports</th>
            </tr>
          </thead>
          <tbody>
            {docker.containers.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  No containers.
                </td>
              </tr>
            ) : (
              docker.containers.map((c, i) => (
                <tr key={i}>
                  <td className="mono">{c.nome}</td>
                  <td>{c.imagem}</td>
                  <td>{c.status}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{c.portas || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: '16px 16px 0' }}>Volumes ({formatNumber(docker.volumes.length)})</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Driver</th>
            </tr>
          </thead>
          <tbody>
            {docker.volumes.length === 0 ? (
              <tr>
                <td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  No volumes.
                </td>
              </tr>
            ) : (
              docker.volumes.map((v) => (
                <tr key={v.nome}>
                  <td className="mono">{v.nome}</td>
                  <td>{v.driver}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function SoftwareTab({ inventory }: { inventory: Inventory }): JSX.Element {
  const tools: ToolsSection | undefined = isSectionError(inventory.ferramentas) ? undefined : inventory.ferramentas;
  const programs: ProgramsSection | undefined = isSectionError(inventory.programas) ? undefined : inventory.programas;

  return (
    <div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: '16px 16px 0' }}>CLI tools</h3>
        {!tools ? (
          <div style={{ padding: 16 }}>
            <SectionUnavailable error={isSectionError(inventory.ferramentas) ? inventory.ferramentas.erro : 'Tools unavailable'} />
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Command</th>
                <th>Version</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(tools.cli).length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                    No CLI tools detected.
                  </td>
                </tr>
              ) : (
                Object.entries(tools.cli).map(([cmd, info]) => (
                  <tr key={cmd}>
                    <td className="mono">{cmd}</td>
                    <td>{info.versao ?? '—'}</td>
                    <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                      {info.caminho ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Card style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: '16px 16px 0' }}>Programs</h3>
        {!programs ? (
          <div style={{ padding: 16 }}>
            <SectionUnavailable error={isSectionError(inventory.programas) ? inventory.programas.erro : 'Programs unavailable'} />
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Publisher</th>
              </tr>
            </thead>
            <tbody>
              {programs.relevantes.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                    No relevant programs found.
                  </td>
                </tr>
              ) : (
                programs.relevantes.map((p, i) => (
                  <tr key={i}>
                    <td>{p.nome}</td>
                    <td>{p.versao ?? '—'}</td>
                    <td style={{ color: 'var(--text-dim)' }}>{p.fabricante ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ScriptsTab({ scripts }: { scripts: readonly ScriptConfigEntry[] }): JSX.Element {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th>Path</th>
            <th>Markers</th>
            <th>Touches GPU</th>
          </tr>
        </thead>
        <tbody>
          {scripts.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                No config scripts found.
              </td>
            </tr>
          ) : (
            scripts.map((s) => (
              <tr key={s.caminho}>
                <td>{s.nome}</td>
                <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  {s.caminho}
                </td>
                <td>{s.marcadores.join(', ') || '—'}</td>
                <td>{s.mexe_em_gpu ? <Badge tone="warn">yes</Badge> : <Badge>no</Badge>}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

function BackupTab({ items }: { items: readonly BackupCheckItem[] }): JSX.Element {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th>
            <th>Status</th>
            <th>Detail</th>
            <th>Criticality</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                No backup checklist available.
              </td>
            </tr>
          ) : (
            items.map((it, i) => (
              <tr key={i}>
                <td>{it.item}</td>
                <td>
                  <Badge tone={it.ok ? 'good' : 'warn'}>{it.ok ? 'ok' : 'pending'}</Badge>
                </td>
                <td style={{ color: 'var(--text-dim)' }}>{it.detalhe}</td>
                <td>{it.criticidade}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
