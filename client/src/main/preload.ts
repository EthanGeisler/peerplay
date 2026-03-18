import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("boilerdeck", {
  platform: {
    getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
    getInstallDir: (): Promise<string> => ipcRenderer.invoke("app:get-install-dir"),
  },

  updater: {
    checkForUpdate: (): Promise<{ updateAvailable: boolean; error?: string }> =>
      ipcRenderer.invoke("app:check-for-update"),
    onUpdateAvailable: (callback: (data: { version: string }) => void): void => {
      ipcRenderer.on("app:update-available", (_event, data) => callback(data));
    },
    onUpdateNotAvailable: (callback: () => void): void => {
      ipcRenderer.on("app:update-not-available", () => callback());
    },
    onUpdateProgress: (callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): void => {
      ipcRenderer.on("app:update-progress", (_event, data) => callback(data));
    },
    onUpdateDownloaded: (callback: (data: { version: string }) => void): void => {
      ipcRenderer.on("app:update-downloaded", (_event, data) => callback(data));
    },
    onUpdateError: (callback: (data: { message: string }) => void): void => {
      ipcRenderer.on("app:update-error", (_event, data) => callback(data));
    },
    removeUpdateListeners: (): void => {
      ipcRenderer.removeAllListeners("app:update-available");
      ipcRenderer.removeAllListeners("app:update-not-available");
      ipcRenderer.removeAllListeners("app:update-progress");
      ipcRenderer.removeAllListeners("app:update-downloaded");
      ipcRenderer.removeAllListeners("app:update-error");
    },
    restartForUpdate: (): Promise<void> => ipcRenderer.invoke("app:restart-for-update"),
  },

  store: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke("store:get", key),
    set: (key: string, value: unknown): Promise<boolean> =>
      ipcRenderer.invoke("store:set", key, value),
    delete: (key: string): Promise<boolean> => ipcRenderer.invoke("store:delete", key),
  },

  crypto: {
    generateKeypair: (): Promise<{ mnemonic: string; pubkeyHex: string }> =>
      ipcRenderer.invoke("crypto:generate-keypair"),
    signChallenge: (challengeHex: string): Promise<{ signature: string; pubkeyHex: string }> =>
      ipcRenderer.invoke("crypto:sign-challenge", challengeHex),
    importMnemonic: (mnemonic: string): Promise<{ pubkeyHex: string }> =>
      ipcRenderer.invoke("crypto:import-mnemonic", mnemonic),
  },

  events: {
    signAndPublishReview: (opts: {
      slug: string;
      rating: number;
      title: string;
      body: string;
    }): Promise<unknown> => ipcRenderer.invoke("events:sign-and-publish-review", opts),
    cacheRelayKeys: (keys: { pubkey: string; privkey: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("events:cache-relay-keys", keys),
  },

  relay: {
    connect: (url: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("relay:connect", url),
    disconnect: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("relay:disconnect"),
    subscribe: (subId: string, filters: unknown[]): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("relay:subscribe", subId, filters),
    unsubscribe: (subId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("relay:unsubscribe", subId),
    publish: (event: unknown): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("relay:publish", event),
    status: (): Promise<{ connected: boolean; url: string | null; subscriptionCount: number }> =>
      ipcRenderer.invoke("relay:status"),
    onEvent: (callback: (data: { subId: string; event: unknown }) => void): void => {
      ipcRenderer.on("relay:on-event", (_event, data) => callback(data));
    },
    onEose: (callback: (data: { subId: string }) => void): void => {
      ipcRenderer.on("relay:on-eose", (_event, data) => callback(data));
    },
    onOk: (callback: (data: { eventId: string; success: boolean; message: string }) => void): void => {
      ipcRenderer.on("relay:on-ok", (_event, data) => callback(data));
    },
    onNotice: (callback: (data: { message: string }) => void): void => {
      ipcRenderer.on("relay:on-notice", (_event, data) => callback(data));
    },
    removeListeners: (): void => {
      ipcRenderer.removeAllListeners("relay:on-event");
      ipcRenderer.removeAllListeners("relay:on-eose");
      ipcRenderer.removeAllListeners("relay:on-ok");
      ipcRenderer.removeAllListeners("relay:on-notice");
    },
  },

  privacy: {
    getSettings: (): Promise<{
      mode: "off" | "tor" | "socks5";
      socksHost: string;
      socksPort: number;
      socksUsername?: string;
      socksPassword?: string;
      routeApiTraffic: boolean;
      routeTorrentTraffic: boolean;
    }> => ipcRenderer.invoke("privacy:get-settings"),
    saveSettings: (settings: {
      mode: "off" | "tor" | "socks5";
      socksHost: string;
      socksPort: number;
      socksUsername?: string;
      socksPassword?: string;
      routeApiTraffic: boolean;
      routeTorrentTraffic: boolean;
    }): Promise<{ success: boolean }> => ipcRenderer.invoke("privacy:save-settings", settings),
    getStatus: (): Promise<{ mode: string; proxyActive: boolean }> =>
      ipcRenderer.invoke("privacy:get-status"),
    testConnection: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("privacy:test-connection"),
  },

  api: {
    proxiedFetch: (opts: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }): Promise<{ status: number; headers: Record<string, string>; body: string }> =>
      ipcRenderer.invoke("api:proxied-fetch", opts),
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

  downloads: {
    startDownload: (opts: {
      magnetUri: string;
      torrentFileBase64?: string;
      gameId: string;
      title: string;
      downloadPath: string;
      developerPubkey?: string;
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
        checkForUpdate: () => Promise<{ updateAvailable: boolean; error?: string }>;
        onUpdateAvailable: (callback: (data: { version: string }) => void) => void;
        onUpdateNotAvailable: (callback: () => void) => void;
        onUpdateProgress: (callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => void;
        onUpdateDownloaded: (callback: (data: { version: string }) => void) => void;
        onUpdateError: (callback: (data: { message: string }) => void) => void;
        removeUpdateListeners: () => void;
        restartForUpdate: () => Promise<void>;
      };
      store: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
      };
      crypto: {
        generateKeypair: () => Promise<{ mnemonic: string; pubkeyHex: string }>;
        signChallenge: (challengeHex: string) => Promise<{ signature: string; pubkeyHex: string }>;
        importMnemonic: (mnemonic: string) => Promise<{ pubkeyHex: string }>;
      };
      events: {
        signAndPublishReview: (opts: {
          slug: string;
          rating: number;
          title: string;
          body: string;
        }) => Promise<unknown>;
        cacheRelayKeys: (keys: { pubkey: string; privkey: string }) => Promise<{ success: boolean }>;
      };
      relay: {
        connect: (url: string) => Promise<{ success: boolean; error?: string }>;
        disconnect: () => Promise<{ success: boolean }>;
        subscribe: (subId: string, filters: unknown[]) => Promise<{ success: boolean; error?: string }>;
        unsubscribe: (subId: string) => Promise<{ success: boolean }>;
        publish: (event: unknown) => Promise<{ success: boolean; error?: string }>;
        status: () => Promise<{ connected: boolean; url: string | null; subscriptionCount: number }>;
        onEvent: (callback: (data: { subId: string; event: unknown }) => void) => void;
        onEose: (callback: (data: { subId: string }) => void) => void;
        onOk: (callback: (data: { eventId: string; success: boolean; message: string }) => void) => void;
        onNotice: (callback: (data: { message: string }) => void) => void;
        removeListeners: () => void;
      };
      privacy: {
        getSettings: () => Promise<{
          mode: "off" | "tor" | "socks5";
          socksHost: string;
          socksPort: number;
          socksUsername?: string;
          socksPassword?: string;
          routeApiTraffic: boolean;
          routeTorrentTraffic: boolean;
        }>;
        saveSettings: (settings: {
          mode: "off" | "tor" | "socks5";
          socksHost: string;
          socksPort: number;
          socksUsername?: string;
          socksPassword?: string;
          routeApiTraffic: boolean;
          routeTorrentTraffic: boolean;
        }) => Promise<{ success: boolean }>;
        getStatus: () => Promise<{ mode: string; proxyActive: boolean }>;
        testConnection: () => Promise<{ success: boolean; error?: string }>;
      };
      api: {
        proxiedFetch: (opts: {
          url: string;
          method: string;
          headers: Record<string, string>;
          body?: string;
        }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
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
      downloads: {
        startDownload: (opts: {
          magnetUri: string;
          torrentFileBase64?: string;
          gameId: string;
          title: string;
          downloadPath: string;
          developerPubkey?: string;
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
