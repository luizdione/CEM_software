import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { readText } from '@cem/shared';
import {
  getHostInfo,
  loadConfig,
  saveConfig,
  recordBackup,
  appendAudit,
  loadHistory,
  readAudit,
  getCemBackupsDir,
  type CemAppConfig,
} from '@cem/core';
import { scanEnvironment, filterArtifacts, type ScanOptions } from '@cem/scanner';
import {
  diagnoseEnvironment,
  proposeRemediations,
  applyRemediation,
  type Remediation,
} from '@cem/diagnostics';
import {
  discoverMcpServers,
  redactServers,
  exportServers,
  importServers,
  upsertServers,
  setServerDisabled,
  removeServer,
} from '@cem/mcp';
import {
  analyzeMarkdown,
  analyzeSkillFile,
  analyzeAgentFile,
  buildTokenReport,
  type MarkdownDoc,
} from '@cem/markdown';
import type { MarkdownStats } from '@cem/core';
import { dirname } from 'node:path';
import {
  loadProfiles,
  saveProfile,
  createProfile,
  deleteProfile,
  PROFILE_TEMPLATES,
  type CreateProfileInput,
} from '@cem/profiles';
import { backupEnvironment, type BackupEnvironmentOptions } from '@cem/backup';
import { gitProvider } from '@cem/sync';
import { buildUsageReport, type UsageWindow } from '@cem/usage';
import {
  readManifest,
  readCemArchive,
  verifyArchive,
  computeRestoreTargets,
  restoreArchive,
  type RestoreOptions,
} from '@cem/restore';
import { IPC } from '../shared/ipc.js';
import { exportPlan, type PlanExportRequest } from './plan.js';
import { loadCachedInventory, runCollectInventory, pickAndLoadInventoryFile } from './inventory.js';
import type { CollectOptions } from '@cem/server-inventory';

const CEM_VERSION = '1.4.0';

async function tokenReport(options: ScanOptions) {
  const scan = await scanEnvironment({ ...options, computeTokens: true });
  const docs = filterArtifacts(scan.artifacts, {
    kinds: ['markdown', 'memory', 'prompt', 'template', 'skill', 'agent'],
  });
  const stats: MarkdownStats[] = [];
  const contents: MarkdownDoc[] = [];
  for (const doc of docs) {
    try {
      stats.push(await analyzeMarkdown(doc.path, doc.scope));
      contents.push({ path: doc.path, content: await readText(doc.path) });
    } catch {
      // skip unreadable
    }
  }
  return buildTokenReport(stats, contents);
}

async function listSkills(options: ScanOptions) {
  const scan = await scanEnvironment({ ...options, computeTokens: false });
  const skillFiles = filterArtifacts(scan.artifacts, { kinds: ['skill'] });
  const mds = skillFiles.filter((a) => /^skill\.md$/i.test(a.name));
  const out = [];
  for (const md of mds) {
    const dir = dirname(md.path);
    const files = skillFiles.filter((a) => a.path.startsWith(dir)).map((a) => a.path);
    try {
      out.push(await analyzeSkillFile(md.path, files, md.scope));
    } catch {
      // skip unreadable
    }
  }
  return out;
}

async function listAgents(options: ScanOptions) {
  const scan = await scanEnvironment({ ...options, computeTokens: false });
  const files = filterArtifacts(scan.artifacts, { kinds: ['agent'] }).filter((a) =>
    /\.mdx?$/i.test(a.name),
  );
  const out = [];
  for (const file of files) {
    try {
      out.push(await analyzeAgentFile(file.path, file.scope));
    } catch {
      // skip unreadable
    }
  }
  return out;
}

/** Register all IPC handlers. Every handler is read-only unless the user acts. */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.scan, (_e, options: ScanOptions = {}) => scanEnvironment(options));
  ipcMain.handle(IPC.diagnose, (_e, options: ScanOptions = {}) => diagnoseEnvironment(options));
  ipcMain.handle(IPC.remediationPropose, async (_e, options: ScanOptions = {}) => {
    const diagnosis = await diagnoseEnvironment(options);
    return proposeRemediations(diagnosis.report);
  });
  ipcMain.handle(IPC.remediationApply, (_e, remediation: Remediation) =>
    applyRemediation(remediation),
  );
  ipcMain.handle(IPC.listMcp, async (_e, options = {}) =>
    redactServers(await discoverMcpServers(options)),
  );

  ipcMain.handle(IPC.mcpExport, async (_e, options = {}) => {
    const servers = await discoverMcpServers(options);
    if (servers.length === 0) return { ok: false, reason: 'no-servers' };
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: 'mcp.json',
      filters: [{ name: 'MCP config', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'cancelled' };
    await exportServers(servers, res.filePath);
    await appendAudit({ action: 'export', ok: true, message: `mcp → ${res.filePath}` }).catch(
      () => undefined,
    );
    return { ok: true, path: res.filePath, count: servers.length };
  });

  ipcMain.handle(IPC.mcpImport, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const src = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'MCP config', extensions: ['json'] }],
    });
    if (src.canceled || !src.filePaths[0]) return { ok: false, reason: 'cancelled' };
    const servers = await importServers(src.filePaths[0]);
    const dest = await dialog.showOpenDialog(win!, {
      title: 'Choose config file to merge into',
      properties: ['openFile'],
      filters: [{ name: 'JSON config', extensions: ['json'] }],
    });
    if (dest.canceled || !dest.filePaths[0]) return { ok: false, reason: 'cancelled' };
    const result = await upsertServers(dest.filePaths[0], servers);
    await appendAudit({ action: 'import', ok: true, message: `mcp → ${dest.filePaths[0]}` }).catch(
      () => undefined,
    );
    return { ok: true, into: dest.filePaths[0], ...result };
  });

  ipcMain.handle(
    IPC.mcpToggle,
    async (_e, { sourcePath, name, disabled }: { sourcePath: string; name: string; disabled: boolean }) => {
      if (sourcePath.includes('#')) return { ok: false, reason: 'nested-config' };
      const ok = await setServerDisabled(sourcePath, name, disabled);
      return { ok };
    },
  );

  ipcMain.handle(
    IPC.mcpRemove,
    async (_e, { sourcePath, name }: { sourcePath: string; name: string }) => {
      if (sourcePath.includes('#')) return { ok: false, reason: 'nested-config' };
      const ok = await removeServer(sourcePath, name);
      await appendAudit({ action: 'remove', ok, message: `mcp remove ${name}` }).catch(
        () => undefined,
      );
      return { ok };
    },
  );
  ipcMain.handle(IPC.tokens, (_e, options: ScanOptions = {}) => tokenReport(options));
  ipcMain.handle(IPC.usageReport, async (_e, { window }: { window?: UsageWindow } = {}) => {
    const scan = await scanEnvironment({ computeTokens: true });
    return buildUsageReport({ ...(window ? { window } : {}), artifacts: scan.artifacts });
  });
  ipcMain.handle(IPC.planExport, async (_e, request: PlanExportRequest) => {
    const result = await exportPlan(request);
    await appendAudit({ action: 'export', ok: result.ok, message: `plan → ${result.path ?? 'cancelled'}` }).catch(
      () => undefined,
    );
    return result;
  });
  ipcMain.handle(IPC.listSkills, (_e, options: ScanOptions = {}) => listSkills(options));
  ipcMain.handle(IPC.listAgents, (_e, options: ScanOptions = {}) => listAgents(options));

  ipcMain.handle(IPC.inventoryLoad, () => loadCachedInventory());
  ipcMain.handle(IPC.inventoryCollect, (_e, options: CollectOptions = {}) =>
    runCollectInventory(options),
  );
  ipcMain.handle(IPC.inventoryLoadFile, () => pickAndLoadInventoryFile());

  ipcMain.handle(IPC.listProfiles, () => loadProfiles());
  ipcMain.handle(IPC.createProfile, async (_e, input: CreateProfileInput) => {
    const profile = createProfile(input);
    await saveProfile(profile);
    return profile;
  });
  ipcMain.handle(IPC.deleteProfile, (_e, id: string) => deleteProfile(id));
  ipcMain.handle(IPC.profileTemplates, () => PROFILE_TEMPLATES);

  ipcMain.handle(IPC.backup, async (_e, options: BackupEnvironmentOptions = {}) => {
    const result = await backupEnvironment({ ...options, cemVersion: CEM_VERSION });
    try {
      await recordBackup({
        id: result.manifest.id,
        path: result.path,
        createdAt: result.manifest.createdAt,
        encrypted: result.encrypted,
        fileCount: result.fileCount,
        bytes: result.bytes,
        formatVersion: result.manifest.formatVersion,
        cemVersion: result.manifest.cemVersion,
        ...(options.notes ? { notes: options.notes } : {}),
      });
      await appendAudit({ action: 'backup', ok: true, message: result.path });
    } catch {
      // registry/audit is best-effort
    }
    return result;
  });

  ipcMain.handle(IPC.listHistory, () => loadHistory());
  ipcMain.handle(IPC.auditLog, (_e, limit = 100) => readAudit(limit));

  ipcMain.handle(IPC.syncStatus, () => gitProvider.status(getCemBackupsDir()));
  ipcMain.handle(IPC.syncInit, (_e, remote?: string) =>
    gitProvider.init(getCemBackupsDir(), remote ? { remote } : {}),
  );
  ipcMain.handle(IPC.syncPush, async (_e, { message, push }: { message?: string; push?: boolean }) => {
    const result = await gitProvider.commitAndPush(getCemBackupsDir(), message || 'CEM backup sync', {
      push: push !== false,
    });
    await appendAudit({ action: 'export', ok: result.ok, message: `git sync: ${result.message}` }).catch(
      () => undefined,
    );
    return result;
  });
  ipcMain.handle(IPC.syncPull, () => gitProvider.pull(getCemBackupsDir()));

  ipcMain.handle(IPC.readManifest, (_e, path: string) => readManifest(path));
  ipcMain.handle(IPC.verify, async (_e, { path, password }: { path: string; password?: string }) => {
    const archive = await readCemArchive(path, password);
    return { manifest: archive.manifest, verification: verifyArchive(archive) };
  });
  ipcMain.handle(
    IPC.restorePlan,
    async (_e, { path, password, options }: PlanArgs) => {
      const archive = await readCemArchive(path, password);
      const verification = verifyArchive(archive);
      const plan = await computeRestoreTargets(archive, options ?? {});
      return { manifest: archive.manifest, verification, plan };
    },
  );
  ipcMain.handle(IPC.restore, async (_e, { path, password, options }: PlanArgs) => {
    const archive = await readCemArchive(path, password);
    const verification = verifyArchive(archive);
    const result = await restoreArchive(archive, options ?? {});
    await appendAudit({
      action: 'restore',
      ok: verification.ok,
      message: path,
      details: { restored: result.restored.length },
    }).catch(() => undefined);
    return { verification, result };
  });

  ipcMain.handle(IPC.pickFile, async (_e, filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: filters ?? [{ name: 'CEM archives', extensions: ['cem'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle(IPC.pickDirectory, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(IPC.getConfig, () => loadConfig());
  ipcMain.handle(IPC.saveConfig, (_e, config: CemAppConfig) => saveConfig(config));
  ipcMain.handle(IPC.platformInfo, () => ({
    host: getHostInfo({ includeHostname: true }),
    cemVersion: CEM_VERSION,
  }));
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url));
}

interface PlanArgs {
  path: string;
  password?: string;
  options?: RestoreOptions;
}
