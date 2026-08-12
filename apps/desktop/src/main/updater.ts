import { app, ipcMain, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import { appendAudit, loadConfig } from '@cem/core';
import { backupEnvironment } from '@cem/backup';
import { IPC } from '../shared/ipc.js';

const { autoUpdater } = electronUpdater;
const CEM_VERSION = '1.4.0';

export interface UpdateStatus {
  state: 'dev' | 'checking' | 'available' | 'none' | 'backing-up' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
  /** Path to the pre-update backup, if one was made. */
  preUpdateBackup?: string;
}

let preUpdateBackup: string | undefined;

function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updateStatus, status);
  }
}

/**
 * Wire up in-app updates. Updates never install without explicit user consent,
 * and a pre-update `.cem` backup is created first (rollback safety). Inert in
 * development (no packaged app / update feed).
 */
export function registerUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => broadcast({ state: 'none' }));
  autoUpdater.on('error', (err) => broadcast({ state: 'error', message: String(err) }));
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'downloaded', version: info.version, ...(preUpdateBackup ? { preUpdateBackup } : {}) }),
  );

  ipcMain.handle(IPC.updateCheck, async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return { state: 'dev' };
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo.version;
      return version ? { state: 'available', version } : { state: 'none' };
    } catch (error) {
      return { state: 'error', message: String(error) };
    }
  });

  ipcMain.handle(IPC.updateDownload, async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return { state: 'dev' };
    // Pre-update backup for rollback safety.
    try {
      const config = await loadConfig();
      if (config.backupBeforeUpdate !== false) {
        broadcast({ state: 'backing-up' });
        const result = await backupEnvironment({ notes: 'Automatic pre-update backup', cemVersion: CEM_VERSION });
        preUpdateBackup = result.path;
        await appendAudit({ action: 'backup', ok: true, message: `pre-update: ${result.path}` });
      }
    } catch (error) {
      await appendAudit({ action: 'backup', ok: false, message: `pre-update failed: ${String(error)}` }).catch(
        () => undefined,
      );
    }
    await autoUpdater.downloadUpdate();
    return { state: 'downloading', ...(preUpdateBackup ? { preUpdateBackup } : {}) };
  });

  ipcMain.handle(IPC.updateInstall, (): { ok: boolean } => {
    if (!app.isPackaged) return { ok: false };
    autoUpdater.quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle(IPC.updatePreBackup, (): { path?: string } => ({
    ...(preUpdateBackup ? { path: preUpdateBackup } : {}),
  }));
}

/** Optionally kick off a silent check shortly after launch. */
export async function maybeAutoCheck(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const config = await loadConfig();
    if (config.autoUpdate) await autoUpdater.checkForUpdates();
  } catch {
    // ignore — auto-check is best-effort
  }
}
