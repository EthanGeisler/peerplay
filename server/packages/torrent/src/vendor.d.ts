declare module "create-torrent" {
  interface CreateTorrentOptions {
    name?: string;
    comment?: string;
    createdBy?: string;
    announceList?: string[][];
    private?: boolean;
    pieceLength?: number;
  }
  function createTorrent(
    input: string | Buffer | File,
    opts: CreateTorrentOptions,
    cb: (err: Error | null, torrent: Buffer) => void,
  ): void;
  export default createTorrent;
}

declare module "parse-torrent" {
  interface ParsedTorrent {
    infoHash?: string;
    magnetURI?: string;
    [key: string]: unknown;
  }
  function parseTorrent(input: string | Buffer | Uint8Array): Promise<ParsedTorrent>;
  export function toMagnetURI(parsed: ParsedTorrent): string;
  export default parseTorrent;
}
