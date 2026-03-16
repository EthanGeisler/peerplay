export function About() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24 }}>About Peerplay</h1>

      <Section title="What is Peerplay?">
        Peerplay is a decentralized game distribution platform. Think Steam, but powered by
        BitTorrent. Game files are distributed peer-to-peer, developers keep 99% of revenue,
        and DRM is optional — chosen by the developer, not the platform.
      </Section>

      <Section title="99/1 Revenue Split">
        <p>For every $19.99 game sold:</p>
        <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
          <StatBox label="Developer" value="$19.79" color="var(--accent-green)" />
          <StatBox label="Platform" value="$0.20" color="var(--text-muted)" />
        </div>
        <p>
          Compare: Steam takes 30%. Epic takes 12%. Peerplay takes 1%.
          BitTorrent distribution means our infrastructure costs are a fraction of traditional
          platforms, so we can pass the savings to creators.
        </p>
      </Section>

      <Section title="How BitTorrent Distribution Works">
        <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>Developer uploads a game build to Peerplay</li>
          <li>Server creates a torrent file and seeds it from dedicated seed boxes</li>
          <li>When you buy a game, your client downloads it via BitTorrent</li>
          <li>While downloading (and after), your client seeds to other buyers</li>
          <li>More buyers = faster downloads for everyone</li>
        </ol>
      </Section>

      <Section title="DRM Tiers (Developer's Choice)">
        <DrmTier
          name="Tier 0: None"
          desc="DRM-free. Download it, keep it, share it. Like GOG."
          color="var(--accent-green)"
        />
        <DrmTier
          name="Tier 1: Light"
          desc="Quick online license check when you launch the game. Works offline after first activation."
          color="var(--accent-yellow)"
        />
        <DrmTier
          name="Tier 2: Encrypted"
          desc="Game files are AES-256 encrypted. Per-user decryption key tied to your account + device. Coming in v0.2."
          color="var(--accent)"
        />
      </Section>

      <Section title="Tech Stack">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            ["Desktop Client", "Electron + React"],
            ["Distribution", "WebTorrent (BitTorrent)"],
            ["Backend", "Node.js + TypeScript"],
            ["Database", "PostgreSQL + Redis"],
            ["Payments", "Stripe Connect"],
            ["Storage", "Backblaze B2 (S3)"],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                padding: 12,
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Open Source">
        The desktop client is MIT-licensed. The backend is proprietary. Documentation is
        open. We believe in transparency — you can audit exactly what the client does with your
        files, your network, and your data.
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: "var(--accent-blue)" }}>
        {title}
      </h2>
      <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.8 }}>{children}</div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        backgroundColor: "var(--bg-tertiary)",
        borderRadius: "var(--radius)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function DrmTier({ name, desc, color }: { name: string; desc: string; color: string }) {
  return (
    <div
      style={{
        padding: 12,
        backgroundColor: "var(--bg-tertiary)",
        borderRadius: "var(--radius)",
        borderLeft: `3px solid ${color}`,
        marginBottom: 8,
      }}
    >
      <div style={{ fontWeight: 700, color, fontSize: 13, marginBottom: 4 }}>{name}</div>
      <div style={{ fontSize: 13 }}>{desc}</div>
    </div>
  );
}
