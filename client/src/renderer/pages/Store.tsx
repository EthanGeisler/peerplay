const styles = {
  heading: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 24,
    color: '#ffffff',
  } as React.CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 20,
  } as React.CSSProperties,
  placeholder: {
    height: 180,
    backgroundColor: '#16213e',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontSize: 14,
    border: '1px solid #0f3460',
  } as React.CSSProperties,
};

export function Store() {
  return (
    <div>
      <h1 style={styles.heading}>Store - Browse Games</h1>
      <div style={styles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={styles.placeholder}>
            Game Placeholder
          </div>
        ))}
      </div>
    </div>
  );
}
