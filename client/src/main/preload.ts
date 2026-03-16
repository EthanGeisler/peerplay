import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("boilerdeck", {
  platform: {
    getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
    getInstallDir: (): Promise<string> => ipcRenderer.invoke("app:get-install-dir"),
  },

  updater: {
    onUpdateDownloaded: (callback: (data: { version: string }) => void): void => {
      ipcRenderer.on("app:update-downloaded", (_event, data) => callback(data));
    },
    removeUpdateListener: (): void => {
      ipcRenderer.removeAllListeners("app:update-downloaded");
    },
    restartForUpdate: (): Promise<void> => ipcRenderer.invoke("app:restart-for-update"),
  },

  store: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke("store:get", key),
    set: (key: string, value: unknown): Promise<boolean> =>
      ipcRenderer.invoke("store:set", key, value),
    delete: (key: string): Promise<boolean> => ipcRenderer.invoke("store:delete", key),
  },

  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke("shell:open-external", url),
  },

  dialog: {
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:select-directory"),
  },

  games: {
    launch: (opts: {
      gameId: string;
      installPath: string;
      exePath: string;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("games:launch", opts),
    uninstall: (installPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("games:uninstall", installPath),
  },

  drm: {
    getFingerprint: (): Promise<string> =>
      ipcRenderer.invoke("drm:get-fingerprint"),
    decryptGame: (opts: {
      installPath: string;
      key: string;
      algorithm: string;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("drm:decrypt-game", opts),
  },

  downloads: {
    startDownload: (opts: {
      magnetUri: string;
      torrentFileBase64?: string;
      gameId: string;
      title: string;
      downloadPath: string;
    }): Promise<{ success: boolean; infoHash?: string }> =>
      ipcRenderer.invoke("downloads:start", opts),
    pauseDownload: (infoHash: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("downloads:pause", infoHash),
    resumeDownload: (infoHash: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("downloads:resume", infoHash),
    cancelDownload: (infoHash: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("downloads:cancel", infoHash),
    getProgress: (): Promise<unknown[]> =>
      ipcRenderer.invoke("downloads:get-progress"),
    onProgressUpdate: (callback: (data: unknown) => void): void => {
      ipcRenderer.on("downloads:progress-update", (_event, data) => callback(data));
    },
    removeProgressListener: (): void => {
      ipcRenderer.removeAllListeners("downloads:progress-update");
    },
    onComplete: (callback: (data: {
      gameId: string;
      title: string;
      infoHash: string;
      downloadPath: string;
    }) => void): void => {
      ipcRenderer.on("downloads:complete", (_event, data) => callback(data));
    },
    removeCompleteListener: (): void => {
      ipcRenderer.removeAllListeners("downloads:complete");
    },
  },
});

// Type declarations for the renderer
declare global {
  interface Window {
    boilerdeck: {
      platform: {
        getVersion: () => Promise<string>;
        getInstallDir: () => Promise<string>;
      };
      updater: {
        onUpdateDownloaded: (callback: (data: { version: string }) => void) => void;
        removeUpdateListener: () => void;
        restartForUpdate: () => Promise<void>;
      };
      store: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      dialog: {
        selectDirectory: () => Promise<string | null>;
      };
      games: {
        launch: (opts: {
          gameId: string;
          installPath: string;
          exePath: string;
        }) => Promise<{ success: boolean; error?: string }>;
        uninstall: (installPath: string) => Promise<{ success: boolean; error?: string }>;
      };
      drm: {
        getFingerprint: () => Promise<string>;
        decryptGame: (opts: {
          installPath: string;
          key: string;
          algorithm: string;
        }) => Promise<{ success: boolean; error?: string }>;
      };
      downloads: {
        startDownload: (opts: {
          magnetUri: string;
          torrentFileBase64?: string;
          gameId: string;
          title: string;
          downloadPath: string;
        }) => Promise<{ success: boolean; infoHash?: string }>;
        pauseDownload: (infoHash: string) => Promise<{ success: boolean }>;
        resumeDownload: (infoHash: string) => Promise<{ success: boolean }>;
        cancelDownload: (infoHash: string) => Promise<{ success: boolean }>;
        getProgress: () => Promise<unknown[]>;
        onProgressUpdate: (callback: (data: unknown) => void) => void;
        removeProgressListener: () => void;
        onComplete: (callback: (data: {
          gameId: string;
          title: string;
          infoHash: string;
          downloadPath: string;
        }) => void) => void;
        removeCompleteListener: () => void;
      };
    };
  }
}
