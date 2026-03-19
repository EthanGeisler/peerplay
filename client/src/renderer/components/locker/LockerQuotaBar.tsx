import type { LockerQuota } from "../../stores/lockerStore";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const styles = {
  container: {
    marginBottom: 16,
  } as React.CSSProperties,
  barOuter: {
    width: "100%",
    height: 8,
    backgroundColor: "#0d1b2a",
    borderRadius: 4,
    overflow: "hidden",
  } as React.CSSProperties,
  barInner: (percent: number) => ({
    height: "100%",
    borderRadius: 4,
    transition: "width 0.3s ease",
    width: `${Math.min(percent, 100)}%`,
    backgroundColor: percent < 70 ? "#3fb950" : percent < 90 ? "#d29922" : "#e94560",
  }) as React.CSSProperties,
  text: {
    fontSize: 12,
    color: "#888",
    marginTop: 4,
  } as React.CSSProperties,
};

export function LockerQuotaBar({ quota }: { quota: LockerQuota }) {
  const percent = quota.max > 0 ? (quota.used / quota.max) * 100 : 0;

  return (
    <div style={styles.container}>
      <div style={styles.barOuter}>
        <div style={styles.barInner(percent)} />
      </div>
      <div style={styles.text}>
        {formatSize(quota.used)} / {formatSize(quota.max)} used
      </div>
    </div>
  );
}
