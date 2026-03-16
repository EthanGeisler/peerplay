const styles = {
  heading: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 24,
    color: '#ffffff',
  } as React.CSSProperties,
  section: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 20,
    border: '1px solid #0f3460',
  } as React.CSSProperties,
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  } as React.CSSProperties,
  value: {
    fontSize: 16,
    color: '#e0e0e0',
  } as React.CSSProperties,
};

export function Settings() {
  return (
    <div>
      <h1 style={styles.heading}>Settings</h1>
      <div style={styles.section}>
        <div style={styles.label}>App Version</div>
        <div style={styles.value}>0.1.0</div>
      </div>
    </div>
  );
}
