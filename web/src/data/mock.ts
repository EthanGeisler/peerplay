export interface Game {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  drmTier: "NONE" | "LIGHT" | "ENCRYPTED";
  coverImageUrl: string;
  screenshots: string[];
  studioName: string;
  exePath: string;
  tags: string[];
  releaseDate: string;
  magnetUri?: string;
  fileSizeMB?: number;
  version?: string;
  featured?: boolean;
}

export const MOCK_GAMES: Game[] = [
  {
    id: "pc01",
    slug: "player-character-01",
    title: "Player Character 01",
    description:
      "A 2D platformer where you begin inside what appears to be a generic fantasy sidescroller. Shortly in, glitches appear — cracks in the world through which other game genres are visible. Jump through cracks, borrow mechanics from each world, and defeat bosses that have escaped their dimensions. All visuals are procedural — no external art assets. Built in Godot.",
    priceCents: 0,
    drmTier: "NONE",
    coverImageUrl: "https://placehold.co/460x215/0d0d2b/e94560?text=Player+Character+01&font=raleway",
    screenshots: [
      "https://placehold.co/1280x720/0d1117/e94560?text=HomeWorld&font=raleway",
      "https://placehold.co/1280x720/1a0a2e/58a6ff?text=ClassicWorld&font=raleway",
      "https://placehold.co/1280x720/0a1628/00d4aa?text=PuzzleWorld&font=raleway",
    ],
    studioName: "EthanGeisler",
    exePath: "PLAYER_CHARACTER_01PeerPlay.exe",
    tags: ["Platformer", "Procedural", "World-Hopping", "Godot"],
    releaseDate: "2026-03-15",
    magnetUri: "magnet:?xt=urn:btih:17f09e866c70ab18d4783395e540760b4c0e5fb9&dn=PLAYER_CHARACTER_01",
    fileSizeMB: 96,
    version: "0.1.0",
    featured: true,
  },
  {
    id: "1",
    slug: "space-explorer",
    title: "Space Explorer",
    description:
      "A thrilling space exploration game where you navigate through uncharted galaxies, discover alien civilizations, and build your fleet. Features procedurally generated star systems, real-time combat, and a branching storyline that adapts to your choices.",
    priceCents: 1999,
    drmTier: "NONE",
    coverImageUrl: "https://placehold.co/460x215/0d1117/e94560?text=Space+Explorer&font=raleway",
    screenshots: [
      "https://placehold.co/1280x720/0d1117/58a6ff?text=Galactic+Map&font=raleway",
      "https://placehold.co/1280x720/0d1117/3fb950?text=Ship+Combat&font=raleway",
      "https://placehold.co/1280x720/0d1117/d29922?text=Alien+World&font=raleway",
    ],
    studioName: "Nebula Games",
    exePath: "SpaceExplorer.exe",
    tags: ["Space", "Exploration", "Strategy"],
    releaseDate: "2026-02-15",
  },
  {
    id: "2",
    slug: "dungeon-crawl",
    title: "Dungeon Crawl",
    description:
      "Descend into procedurally generated dungeons filled with deadly traps, fearsome monsters, and legendary loot. Each run is different. Permadeath keeps the stakes high — one wrong step and it's back to the surface.",
    priceCents: 999,
    drmTier: "LIGHT",
    coverImageUrl: "https://placehold.co/460x215/1a0a2e/c9a0dc?text=Dungeon+Crawl&font=raleway",
    screenshots: [
      "https://placehold.co/1280x720/1a0a2e/c9a0dc?text=Dark+Depths&font=raleway",
      "https://placehold.co/1280x720/1a0a2e/e94560?text=Boss+Fight&font=raleway",
    ],
    studioName: "Rogue Pixel Studios",
    exePath: "DungeonCrawl.exe",
    tags: ["Roguelike", "Action", "RPG"],
    releaseDate: "2026-01-20",
  },
  {
    id: "3",
    slug: "pixel-racing",
    title: "Pixel Racing",
    description:
      "Retro-style top-down racing with modern physics. Build custom cars, race across 40+ tracks, and compete in online tournaments. Free to play with no pay-to-win mechanics.",
    priceCents: 0,
    drmTier: "NONE",
    coverImageUrl: "https://placehold.co/460x215/0a1628/00d4aa?text=Pixel+Racing&font=raleway",
    screenshots: [
      "https://placehold.co/1280x720/0a1628/00d4aa?text=Desert+Track&font=raleway",
      "https://placehold.co/1280x720/0a1628/58a6ff?text=Garage&font=raleway",
    ],
    studioName: "Turbo Indie",
    exePath: "PixelRacing.exe",
    tags: ["Racing", "Retro", "Free"],
    releaseDate: "2026-03-01",
  },
  {
    id: "4",
    slug: "neon-drift",
    title: "Neon Drift",
    description:
      "Cyberpunk street racing through rain-soaked neon cities. Drift through tight corners, outrun corporate security, and upgrade your ride with illegal mods. Synthwave soundtrack included.",
    priceCents: 1499,
    drmTier: "LIGHT",
    coverImageUrl: "https://placehold.co/460x215/1a0028/ff6ec7?text=Neon+Drift&font=raleway",
    screenshots: [
      "https://placehold.co/1280x720/1a0028/ff6ec7?text=Night+Race&font=raleway",
      "https://placehold.co/1280x720/1a0028/58a6ff?text=Garage+Mods&font=raleway",
      "https://placehold.co/1280x720/1a0028/00d4aa?text=Downtown&font=raleway",
    ],
    studioName: "Turbo Indie",
    exePath: "NeonDrift.exe",
    tags: ["Racing", "Cyberpunk", "Action"],
    releaseDate: "2026-03-10",
  },
  {
    id: "5",
    slug: "farm-together",
    title: "Farm Together",
    description:
      "Build your dream farm from scratch. Plant crops, raise animals, decorate your homestead, and trade with neighbors in a relaxing multiplayer world. No timers, no pressure — just farming.",
    priceCents: 1299,
    drmTier: "NONE",
    coverImageUrl: "https://placehold.co/460x215/0a2810/7dde92?text=Farm+Together&font=raleway",
    screenshots: [
      "https://placehold.co/1280x720/0a2810/7dde92?text=Spring+Harvest&font=raleway",
      "https://placehold.co/1280x720/0a2810/d29922?text=Autumn+Fair&font=raleway",
    ],
    studioName: "Cozy Craft Games",
    exePath: "FarmTogether.exe",
    tags: ["Simulation", "Relaxing", "Multiplayer"],
    releaseDate: "2026-02-28",
  },
  {
    id: "6",
    slug: "echo-protocol",
    title: "Echo Protocol",
    description:
      "A tense narrative thriller set in a near-future surveillance state. Hack into corporate networks, evade AI-driven security, and uncover a conspiracy that threatens to reshape society. Every choice matters.",
    priceCents: 2499,
    drmTier: "LIGHT",
    coverImageUrl: "https://placehold.co/460x215/0d1117/58a6ff?text=Echo+Protocol&font=raleway",
    screenshots: [
      "https://placehold.co/1280x720/0d1117/58a6ff?text=Terminal+Hack&font=raleway",
      "https://placehold.co/1280x720/0d1117/e94560?text=Chase+Scene&font=raleway",
      "https://placehold.co/1280x720/0d1117/d29922?text=Safe+House&font=raleway",
    ],
    studioName: "Nebula Games",
    exePath: "EchoProtocol.exe",
    tags: ["Adventure", "Narrative", "Stealth"],
    releaseDate: "2026-03-12",
  },
];

export interface OwnedGame {
  gameId: string;
  purchasedAt: string;
}

export const MOCK_LIBRARY: OwnedGame[] = [];
