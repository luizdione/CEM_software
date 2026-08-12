import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';

/** The typed API surface exposed to the renderer as `window.cem`. */
const api = {
  scan: (options?: unknown) => ipcRenderer.invoke(IPC.scan, options),
  diagnose: (options?: unknown) => ipcRenderer.invoke(IPC.diagnose, options),
  remediationPropose: (options?: unknown) => ipcRenderer.invoke(IPC.remediationPropose, options),
  remediationApply: (remediation: unknown) => ipcRenderer.invoke(IPC.remediationApply, remediation),
  listMcp: (options?: unknown) => ipcRenderer.invoke(IPC.listMcp, options),
  mcpExport: (options?: unknown) => ipcRenderer.invoke(IPC.mcpExport, options),
  mcpImport: () => ipcRenderer.invoke(IPC.mcpImport),
  mcpToggle: (args: unknown) => ipcRenderer.invoke(IPC.mcpToggle, args),
  mcpRemove: (args: unknown) => ipcRenderer.invoke(IPC.mcpRemove, args),
  listSkills: (options?: unknown) => ipcRenderer.invoke(IPC.listSkills, options),
  listAgents: (options?: unknown) => ipcRenderer.invoke(IPC.listAgents, options),
  tokens: (options?: unknown) => ipcRenderer.invoke(IPC.tokens, options),
  usageReport: (args?: unknown) => ipcRenderer.invoke(IPC.usageReport, args),
  planExport: (request: unknown) => ipcRenderer.invoke(IPC.planExport, request),
  listProfiles: () => ipcRenderer.invoke(IPC.listProfiles),
  createProfile: (input: unknown) => ipcRenderer.invoke(IPC.createProfile, input),
  deleteProfile: (id: string) => ipcRenderer.invoke(IPC.deleteProfile, id),
  profileTemplates: () => ipcRenderer.invoke(IPC.profileTemplates),
  backup: (options?: unknown) => ipcRenderer.invoke(IPC.backup, options),
  readManifest: (path: string) => ipcRenderer.invoke(IPC.readManifest, path),
  verify: (args: unknown) => ipcRenderer.invoke(IPC.verify, args),
  restorePlan: (args: unknown) => ipcRenderer.invoke(IPC.restorePlan, args),
  restore: (args: unknown) => ipcRenderer.invoke(IPC.restore, args),
  pickFile: (filters?: unknown) => ipcRenderer.invoke(IPC.pickFile, filters),
  pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory),
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  saveConfig: (config: unknown) => ipcRenderer.invoke(IPC.saveConfig, config),
  platformInfo: () => ipcRenderer.invoke(IPC.platformInfo),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  listHistory: () => ipcRenderer.invoke(IPC.listHistory),
  auditLog: (limit?: number) => ipcRenderer.invoke(IPC.auditLog, limit),
  syncStatus: () => ipcRenderer.invoke(IPC.syncStatus),
  syncInit: (remote?: string) => ipcRenderer.invoke(IPC.syncInit, remote),
  syncPush: (args: unknown) => ipcRenderer.invoke(IPC.syncPush, args),
  syncPull: () => ipcRenderer.invoke(IPC.syncPull),
  updateCheck: () => ipcRenderer.invoke(IPC.updateCheck),
  updateDownload: () => ipcRenderer.invoke(IPC.updateDownload),
  updateInstall: () => ipcRenderer.invoke(IPC.updateInstall),
  updatePreBackup: () => ipcRenderer.invoke(IPC.updatePreBackup),
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown): void => cb(status);
    ipcRenderer.on(IPC.updateStatus, listener);
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener);
  },
  inventoryLoad: () => ipcRenderer.invoke(IPC.inventoryLoad),
  inventoryCollect: (options?: unknown) => ipcRenderer.invoke(IPC.inventoryCollect, options),
  inventoryLoadFile: () => ipcRenderer.invoke(IPC.inventoryLoadFile),
};

contextBridge.exposeInMainWorld('cem', api);

export type CemApi = typeof api;
