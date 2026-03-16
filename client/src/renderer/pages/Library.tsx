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

export function Library() {
  return (
    <div>
      <h1 style={styles.heading}>My Library</h1>
      <p style={styles.empty}>
        Your library is empty. Browse the Store to find games.
      </p>
    </div>
  );
}
