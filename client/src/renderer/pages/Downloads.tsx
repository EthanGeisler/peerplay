const styles = {
  heading: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 24,
    color: '#ffffff',
  } as React.CSSProperties,
  empty: {
    color: '#888',
    fontSize: 16,
    marginTop: 40,
    textAlign: 'center',
  } as React.CSSProperties,
};

export function Downloads() {
  return (
    <div>
      <h1 style={styles.heading}>Downloads</h1>
      <p style={styles.empty}>No active downloads.</p>
    </div>
  );
}
