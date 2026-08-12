/**
 * Native port of the Python `coletar_docker()`. Docker's CLI exists on every
 * OS, so unlike wsl/programs/tools this collector is NOT gated on isWindows —
 * it simply reports `disponivel: false` when the `docker` binary is missing
 * or unreachable.
 */
import type { DockerContainer, DockerImage, DockerSection, DockerVolume } from '../types.js';
import { runCommand, toGb } from './exec.js';

/** Strips readonly so the section can be built up incrementally, matching DockerSection's shape on return. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export async function collectDocker(opts?: { timeoutMs?: number }): Promise<DockerSection> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const runDocker = (args: string[]) => runCommand('docker', args, { timeoutMs });

  try {
    const verResult = await runDocker(['version', '--format', '{{json .}}']);
    if (!verResult.ok) {
      return {
        disponivel: false,
        erro: verResult.stderr || 'docker indisponivel',
        imagens: [],
        containers: [],
        volumes: [],
      };
    }

    const dados: Mutable<DockerSection> = {
      disponivel: true,
      imagens: [],
      containers: [],
      volumes: [],
    };

    try {
      const v = JSON.parse(verResult.stdout) as {
        Client?: { Version?: string };
        Server?: { Version?: string } | null;
      };
      dados.versao_cliente = v.Client?.Version ?? null;
      dados.versao_servidor = v.Server?.Version ?? null;
    } catch {
      // Malformed JSON — the TS contract has no raw-version fallback field
      // (unlike Python's `versao_bruta`), so this is intentionally dropped.
    }

    // Runtime names come from a plain range: the {{...dict...}} template isn't
    // supported by every client version and fails silently there.
    const runtimesResult = await runDocker(['info', '--format', '{{range $k, $v := .Runtimes}}{{$k}}\n{{end}}']);
    if (runtimesResult.ok) {
      const runtimes = runtimesResult.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .sort();
      dados.runtimes = runtimes;
      dados.runtime_nvidia = runtimes.includes('nvidia');
    }

    const driverResult = await runDocker(['info', '--format', '{{.Driver}}']);
    if (driverResult.ok && driverResult.stdout.trim()) dados.storage_driver = driverResult.stdout.trim();

    const rootDirResult = await runDocker(['info', '--format', '{{.DockerRootDir}}']);
    if (rootDirResult.ok && rootDirResult.stdout.trim()) dados.root_dir = rootDirResult.stdout.trim();

    const ncpuResult = await runDocker(['info', '--format', '{{.NCPU}}']);
    if (ncpuResult.ok && ncpuResult.stdout.trim()) {
      const bruto = ncpuResult.stdout.trim();
      const n = Number(bruto);
      // Contract allows number|string for cpus_visiveis: keep the raw text on parse failure, like Python's ValueError fallback.
      dados.cpus_visiveis = Number.isFinite(n) ? Math.trunc(n) : bruto;
    }

    const memResult = await runDocker(['info', '--format', '{{.MemTotal}}']);
    if (memResult.ok && memResult.stdout.trim()) {
      dados.ram_visivel_gb = toGb(Number(memResult.stdout.trim()));
    }

    const imgCountResult = await runDocker(['info', '--format', '{{.Images}}']);
    if (imgCountResult.ok && imgCountResult.stdout.trim()) {
      const n = Number(imgCountResult.stdout.trim());
      if (Number.isFinite(n)) dados.n_imagens = Math.trunc(n);
    }

    const containerCountResult = await runDocker(['info', '--format', '{{.Containers}}']);
    if (containerCountResult.ok && containerCountResult.stdout.trim()) {
      const n = Number(containerCountResult.stdout.trim());
      if (Number.isFinite(n)) dados.n_containers = Math.trunc(n);
    }

    const imagesResult = await runDocker([
      'images',
      '--format',
      '{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.ID}}\t{{.CreatedSince}}',
    ]);
    if (imagesResult.ok && imagesResult.stdout) {
      const imagens: DockerImage[] = [];
      for (const linha of imagesResult.stdout.split(/\r?\n/)) {
        if (!linha) continue;
        const partes = linha.split('\t');
        if (partes.length >= 4) {
          imagens.push({
            repositorio: partes[0] ?? '',
            tag: partes[1] ?? '',
            tamanho: partes[2] ?? '',
            id: partes[3] ?? '',
            criada: partes[4] ?? '',
          });
        }
      }
      dados.imagens = imagens;
    }

    const psResult = await runDocker(['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}']);
    if (psResult.ok && psResult.stdout) {
      const containers: DockerContainer[] = [];
      for (const linha of psResult.stdout.split(/\r?\n/)) {
        if (!linha) continue;
        const partes = linha.split('\t');
        if (partes.length >= 3) {
          containers.push({
            nome: partes[0] ?? '',
            imagem: partes[1] ?? '',
            status: partes[2] ?? '',
            portas: partes[3] ?? '',
          });
        }
      }
      dados.containers = containers;
    }

    const volResult = await runDocker(['volume', 'ls', '--format', '{{.Name}}\t{{.Driver}}']);
    if (volResult.ok) {
      const volumes: DockerVolume[] = [];
      for (const linha of volResult.stdout.split(/\r?\n/)) {
        if (!linha.trim()) continue;
        const partes = linha.split('\t');
        volumes.push({ nome: partes[0] ?? '', driver: partes[partes.length - 1] ?? '' });
      }
      dados.volumes = volumes;
    }

    return dados;
  } catch (err) {
    return {
      disponivel: false,
      erro: err instanceof Error ? err.message : String(err),
      imagens: [],
      containers: [],
      volumes: [],
    };
  }
}
