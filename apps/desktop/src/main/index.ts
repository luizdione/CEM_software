import { app, BrowserWindow, dialog, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@cem/shared';
import { registerIpcHandlers } from './ipc.js';
import { registerUpdater, maybeAutoCheck } from './updater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger({ level: 'info' });

// A flaky GPU driver (repeated display-driver resets / TDR) will take down any
// hardware-accelerated Electron app. Provide an escape hatch so CEM can run
// without GPU acceleration and keep working while the machine's GPU driver is
// unstable: set CEM_DISABLE_GPU=1 or pass --disable-gpu.
if (process.env['CEM_DISABLE_GPU'] === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
  log.info('GPU acceleration disabled (CEM_DISABLE_GPU / --disable-gpu)');
}

// A stray error in the main process must never silently terminate CEM; log it
// and keep running so the window does not just vanish.
process.on('uncaughtException', (error) => {
  log.error('uncaught exception in main process', { error: String(error) });
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection in main process', { reason: String(reason) });
});

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    title: 'Claude Environment Manager',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on('ready-to-show', () => window.show());

  // If the renderer or GPU process is killed — commonly by a GPU-driver
  // TDR/reset on an unstable machine — reload instead of leaving a blank,
  // frozen window that looks like the app "closed". Throttled so an
  // immediately-recurring crash does not spin in a reload loop.
  let lastReload = 0;
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('renderer process gone', { reason: details.reason, exitCode: details.exitCode });
    if (details.reason === 'clean-exit' || window.isDestroyed()) return;
    const now = Date.now();
    if (now - lastReload < 4000) {
      log.error('renderer crashed again too soon; not reloading automatically');
      return;
    }
    lastReload = now;
    window.webContents.reload();
  });

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // In development electron-vite injects ELECTRON_RENDERER_URL.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Only one CEM instance may run at a time: concurrent instances fight over the
// same user-data/GPU-cache directories on Windows ("Unable to move the cache:
// access denied"). A second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    // Log GPU/utility child-process deaths so a "the app vanished" report has a
    // breadcrumb instead of silence.
    app.on('child-process-gone', (_event, details) => {
      log.error('child process gone', { type: details.type, reason: details.reason });
    });

    try {
      registerIpcHandlers();
      registerUpdater();
      createWindow();
      void maybeAutoCheck();
    } catch (error) {
      log.error('startup failed', { error: String(error) });
      dialog.showErrorBox(
        'Claude Environment Manager',
        `CEM failed to start:\n\n${String(error)}\n\n` +
          'If this persists, try launching with GPU acceleration disabled ' +
          '(set CEM_DISABLE_GPU=1).',
      );
      app.quit();
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
