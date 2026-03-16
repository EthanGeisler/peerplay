import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('boilerdeck', {
  platform: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  },
  games: {
    launch: (exePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('games:launch', exePath),
  },
  downloads: {
    startDownload: (magnetUri: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('downloads:start', magnetUri),
    pauseDownload: (infoHash: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('downloads:pause', infoHash),
    getProgress: (): Promise<unknown[]> =>
      ipcRenderer.invoke('downloads:get-progress'),
  },
});

declare global {
  interface Window {
    boilerdeck: {
      platform: {
        getVersion: () => Promise<string>;
      };
      games: {
        launch: (exePath: string) => Promise<{ success: boolean }>;
      };
      downloads: {
        startDownload: (magnetUri: string) => Promise<{ success: boolean }>;
        pauseDownload: (infoHash: string) => Promise<{ success: boolean }>;
        getProgress: () => Promise<unknown[]>;
      };
    };
  }
}
