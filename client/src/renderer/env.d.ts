/// <reference types="vite/client" />

// Re-declare window.boilerdeck for the renderer process
// (The canonical declaration lives in src/main/preload.ts but that file
// isn't included in the renderer tsconfig.)
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
        getPublicKey: () => Promise<string | null>;
        hasKey: () => Promise<boolean>;
        exportMnemonic: () => Promise<null>;
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
      relays: {
        list: () => Promise<Array<{ url: string; name: string; isDefault: boolean; enabled: boolean }>>;
        add: (url: string) => Promise<Array<{ url: string; name: string; isDefault: boolean; enabled: boolean }>>;
        remove: (url: string) => Promise<{ error?: string } | Array<{ url: string; name: string; isDefault: boolean; enabled: boolean }>>;
        toggle: (url: string, enabled: boolean) => Promise<Array<{ url: string; name: string; isDefault: boolean; enabled: boolean }>>;
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
      tor: {
        start: () => Promise<{ running: boolean; bootstrapProgress: number; socksPort: number; error?: string }>;
        stop: () => Promise<{ success: boolean }>;
        status: () => Promise<{ running: boolean; bootstrapProgress: number; socksPort: number }>;
        onBootstrapProgress: (callback: (data: { progress: number; summary: string }) => void) => void;
        removeBootstrapListener: () => void;
      };
      api: {
        proxiedFetch: (opts: {
          url: string;
          method: string;
          headers: Record<string, string>;
          body?: string;
        }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
      };
      media: {
        getFilePath: (installPath: string) => Promise<string | null>;
        startServer: (dir: string, fileName: string) => Promise<string>;
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

export {};
