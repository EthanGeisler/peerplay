declare module "webtorrent" {
  interface TorrentOptions {
    path?: string;
    maxWebConns?: number;
  }

  interface Torrent {
    infoHash: string;
    magnetURI: string;
    name: string;
    path: string;
    progress: number;
    downloaded: number;
    uploaded: number;
    downloadSpeed: number;
    uploadSpeed: number;
    numPeers: number;
    length: number;
    done: boolean;
    paused: boolean;
    files: TorrentFile[];
    pause(): void;
    resume(): void;
    destroy(opts?: { destroyStore?: boolean }, cb?: () => void): void;
    on(event: "ready", callback: () => void): void;
    on(event: "done", callback: () => void): void;
    on(event: "error", callback: (err: Error) => void): void;
    on(event: "download", callback: (bytes: number) => void): void;
    on(event: "upload", callback: (bytes: number) => void): void;
    on(event: "wire", callback: (wire: unknown) => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }

  interface TorrentFile {
    name: string;
    path: string;
    length: number;
    offset: number;
  }

  interface WebTorrentOptions {
    maxConns?: number;
    dht?: boolean;
    tracker?: boolean | object;
    webSeeds?: boolean;
    downloadLimit?: number;
    uploadLimit?: number;
  }

  class Instance {
    torrents: Torrent[];
    downloadSpeed: number;
    uploadSpeed: number;
    ratio: number;
    add(
      torrentId: string | Buffer,
      opts?: TorrentOptions,
    ): Torrent;
    remove(torrentId: string | Torrent, opts?: { destroyStore?: boolean }, cb?: () => void): void;
    destroy(cb?: () => void): void;
    on(event: "error", callback: (err: Error) => void): void;
    on(event: "torrent", callback: (torrent: Torrent) => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }

  export default class WebTorrent {
    constructor(opts?: WebTorrentOptions);
    torrents: Torrent[];
    downloadSpeed: number;
    uploadSpeed: number;
    ratio: number;
    add(
      torrentId: string | Buffer,
      opts?: TorrentOptions,
    ): Torrent;
    remove(torrentId: string | Torrent, opts?: { destroyStore?: boolean }, cb?: () => void): void;
    destroy(cb?: () => void): void;
    on(event: "error", callback: (err: Error) => void): void;
    on(event: "torrent", callback: (torrent: Torrent) => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }

  export { Instance, Torrent, TorrentFile, TorrentOptions, WebTorrentOptions };
}
