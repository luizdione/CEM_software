/**
 * Native port of `coletar_conda()` from coletar_inventario.py. Reads conda
 * environments straight off disk (`conda-meta` JSON for conda packages,
 * `site-packages` dist-info for pip packages) — never invokes the `conda`
 * binary, so it stays fast and works even when conda itself is slow or broken.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CondaEnv, CondaHighlight, CondaRc, CondaSection } from '../types.js';
import { isWindows, round } from './exec.js';

// Packages that mark an environment as bioinformatics / structural / ML.
// Mirrors MARCADORES_BIOINFO in coletar_inventario.py exactly (order and all).
const BIOINFO_MARKERS: Record<string, readonly string[]> = {
  estrutural: [
    'boltz', 'openmm', 'pdbfixer', 'mdanalysis', 'biopython', 'rdkit',
    'openbabel', 'prody', 'nglview', 'py3dmol', 'pymol', 'vmd',
    'alphafold', 'colabfold', 'openfold', 'esm', 'fair-esm', 'chai',
    'gromacs', 'ambertools', 'parmed', 'mdtraj', 'plip', 'vina',
    'autodock', 'smina', 'meeko', 'spyrmsd', 'biotite', 'foldseek',
  ],
  genomica: [
    'samtools', 'bcftools', 'bedtools', 'htslib', 'bwa', 'bowtie2',
    'hisat2', 'star', 'salmon', 'kallisto', 'fastqc', 'multiqc',
    'trimmomatic', 'cutadapt', 'gatk4', 'picard', 'plink', 'plink2',
    'vcftools', 'snpeff', 'nextflow', 'nf-core', 'snakemake',
    'pysam', 'scanpy', 'anndata', 'scvi-tools', 'pyranges',
  ],
  ml_gpu: [
    'torch', 'pytorch', 'torchvision', 'torchaudio', 'triton',
    'tensorflow', 'jax', 'jaxlib', 'cupy', 'numba', 'onnxruntime',
    'cuequivariance', 'cuequivariance-ops-torch-cu12', 'flash-attn',
    'xformers', 'bitsandbytes', 'transformers', 'accelerate',
    'pytorch-lightning', 'lightning', 'deepspeed', 'vllm',
    'cuda-version', 'cudatoolkit', 'cudnn', 'nccl',
  ],
  dados: [
    'numpy', 'scipy', 'pandas', 'polars', 'scikit-learn', 'statsmodels',
    'matplotlib', 'seaborn', 'plotly', 'jupyterlab', 'notebook',
    'r-base', 'rpy2', 'pyarrow', 'h5py', 'netcdf4', 'dask', 'xarray',
  ],
};

// Files walked per env before the size measurement gives up and reports truncated.
const FILE_WALK_LIMIT = 200_000;

interface PackageInfo {
  readonly nome: string;
  readonly versao: string;
  readonly origem: 'conda' | 'pip';
}

const UNAVAILABLE: CondaSection = { disponivel: false, instalacoes: [], condarc: null, ambientes: [] };

export async function collectConda(opts?: { measureSize?: boolean }): Promise<CondaSection> {
  try {
    const measureSize = opts?.measureSize ?? true; // mirrors Python's medir_tamanho=True default

    const candidates = [
      join(homedir(), 'miniforge3'),
      join(homedir(), 'miniconda3'),
      join(homedir(), 'anaconda3'),
      ...(isWindows ? ['C:/ProgramData/miniforge3', 'C:/ProgramData/Anaconda3'] : []),
    ];
    const roots: string[] = [];
    for (const c of candidates) {
      if (await isDir(c)) roots.push(c);
    }
    if (roots.length === 0) return UNAVAILABLE;

    const firstRoot = roots[0];
    const condarc = firstRoot ? await readCondarc(firstRoot) : null;

    // (base, root) plus every subdirectory of root/envs, sorted like Python's sorted(envs.iterdir()).
    const prefixes: Array<{ nome: string; caminho: string }> = [];
    for (const root of roots) {
      prefixes.push({ nome: 'base', caminho: root });
      const envsDir = join(root, 'envs');
      if (await isDir(envsDir)) {
        let entries: string[] = [];
        try {
          entries = (await readdir(envsDir, { withFileTypes: true }))
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort(cmp);
        } catch {
          entries = [];
        }
        for (const name of entries) {
          prefixes.push({ nome: name, caminho: join(envsDir, name) });
        }
      }
    }

    const ambientes: CondaEnv[] = [];
    for (const { nome, caminho } of prefixes) {
      const pacotes = await readEnvPackages(caminho);
      const entries = Object.entries(pacotes);
      if (entries.length === 0) continue; // env with no readable packages: skip, like Python's `if not pacotes: continue`

      const py = pacotes['python']?.versao ?? null;

      const destaques: Record<string, CondaHighlight> = {};
      for (const [chave, info] of entries) {
        const categoria = classifyPackage(chave) ?? classifyPackage(info.nome);
        if (categoria) {
          destaques[info.nome] = { versao: info.versao, origem: info.origem, categoria };
        }
      }

      const base = {
        nome,
        caminho,
        python: py,
        total_pacotes: entries.length,
        n_conda: entries.filter(([, info]) => info.origem === 'conda').length,
        n_pip: entries.filter(([, info]) => info.origem === 'pip').length,
        destaques: sortRecordByKeyLower(destaques),
        pacotes: sortRecordByKey(
          Object.fromEntries(entries.map(([k, info]): [string, string] => [k, info.versao])),
        ),
      };

      // CUDA support is inferred from torch's own build string (e.g. "2.1.0+cu121", "2.1.0+cpu").
      let torchFields: Partial<Pick<CondaEnv, 'torch' | 'torch_cuda' | 'torch_somente_cpu'>> = {};
      const torchInfo = pacotes['torch'];
      if (torchInfo) {
        const v = torchInfo.versao;
        const m = /\+cu(\d+)/.exec(v);
        if (m) {
          const raw = m[1] ?? '';
          torchFields = { torch: v, torch_cuda: `${raw.slice(0, 2)}.${raw.slice(2)}` };
        } else if (v.toLowerCase().includes('cpu')) {
          torchFields = { torch: v, torch_cuda: null, torch_somente_cpu: true };
        } else {
          torchFields = { torch: v };
        }
      }

      let sizeFields: Partial<Pick<CondaEnv, 'tamanho_gb' | 'tamanho_truncado'>> = {};
      if (measureSize) {
        const { totalBytes, truncated } = await folderSize(caminho, FILE_WALK_LIMIT);
        sizeFields = { tamanho_gb: round(totalBytes / 1024 ** 3, 1), tamanho_truncado: truncated };
      }

      ambientes.push({ ...base, ...torchFields, ...sizeFields });
    }

    return { disponivel: true, instalacoes: roots, condarc, ambientes };
  } catch {
    return UNAVAILABLE;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// .condarc affects channels/solver/reproducibility: ~/.condarc wins over the base install's.
// Mirrors the Python loop exactly, including that it stops at the first *existing* file even
// if reading it then fails (no fallback to the second candidate in that case).
async function readCondarc(firstRoot: string): Promise<CondaRc | null> {
  const candidates = [join(homedir(), '.condarc'), join(firstRoot, '.condarc')];
  for (const path of candidates) {
    if (await isRegularFile(path)) {
      try {
        const conteudo = await readFile(path, 'utf8');
        return { caminho: path, conteudo };
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Reads conda-meta/*.json (conda packages) and Lib/site-packages or lib/site-packages
// (*.dist-info -> pip packages) straight off disk. Mirrors _pacotes_do_env().
async function readEnvPackages(prefix: string): Promise<Record<string, PackageInfo>> {
  const pacotes: Record<string, PackageInfo> = {};

  const metaDir = join(prefix, 'conda-meta');
  if (await isDir(metaDir)) {
    let names: string[] = [];
    try {
      names = (await readdir(metaDir)).filter((n) => n.toLowerCase().endsWith('.json'));
    } catch {
      names = [];
    }
    for (const name of names) {
      // Pattern: <nome>-<versao>-<build>.json
      const stem = name.slice(0, -'.json'.length);
      const parts = rsplit(stem, '-', 2);
      if (parts.length === 3) {
        const [nomeOrig, versao] = parts as [string, string, string];
        pacotes[nomeOrig.toLowerCase()] = { nome: nomeOrig, versao, origem: 'conda' };
      }
    }
  }

  for (const sub of ['Lib/site-packages', 'lib/site-packages']) {
    const spDir = join(prefix, sub);
    if (!(await isDir(spDir))) continue;
    let names: string[] = [];
    try {
      names = (await readdir(spDir)).filter((n) => n.toLowerCase().endsWith('.dist-info'));
    } catch {
      names = [];
    }
    for (const name of names) {
      const stem = name.slice(0, -'.dist-info'.length);
      const parts = rsplit(stem, '-', 1);
      if (parts.length === 2) {
        const [nomeOrig, versao] = parts as [string, string];
        const chave = nomeOrig.toLowerCase().replace(/_/g, '-');
        if (!(chave in pacotes)) {
          pacotes[chave] = { nome: nomeOrig, versao, origem: 'pip' };
        }
      }
    }
    break; // only the first site-packages dir that exists, like Python's `break`
  }

  return pacotes;
}

/** Mirrors Python's str.rsplit(sep, maxSplits): split from the right, at most maxSplits cuts. */
function rsplit(s: string, sep: string, maxSplits: number): string[] {
  const parts = s.split(sep);
  if (parts.length <= maxSplits + 1) return parts;
  const cut = parts.length - maxSplits;
  return [parts.slice(0, cut).join(sep), ...parts.slice(cut)];
}

/** Codepoint string comparison — Python's default sort is not locale-aware. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortRecordByKey<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => cmp(a, b)));
}

function sortRecordByKeyLower<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => cmp(a.toLowerCase(), b.toLowerCase())));
}

/** Returns the bioinfo category for a package name, or null. Mirrors classificar_pacote(). */
function classifyPackage(nome: string): string | null {
  const n = nome.toLowerCase();
  for (const [categoria, pacotes] of Object.entries(BIOINFO_MARKERS)) {
    if (pacotes.includes(n)) return categoria;
  }
  return null;
}

/** Sums file sizes under `root`; stops counting past `fileLimit` files. Mirrors _tamanho_pasta(). */
async function folderSize(root: string, fileLimit: number): Promise<{ totalBytes: number; truncated: boolean }> {
  let total = 0;
  let n = 0;
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirents) {
      if (truncated) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size;
        } catch {
          // ignore, matches Python's `except OSError: pass`
        }
        n += 1;
        if (n > fileLimit) {
          truncated = true;
          return;
        }
      }
    }
  }

  await walk(root);
  return { totalBytes: total, truncated };
}
