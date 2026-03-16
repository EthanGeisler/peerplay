import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Store } from './pages/Store';
import { Library } from './pages/Library';
import { Downloads } from './pages/Downloads';
import { Settings } from './pages/Settings';

const NAV_ITEMS = [
  { label: 'Store', path: '/' },
  { label: 'Library', path: '/library' },
  { label: 'Downloads', path: '/downloads' },
  { label: 'Settings', path: '/settings' },
] as const;

const styles = {
  container: {
    display: 'flex',
    height: '100vh',
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
  } as React.CSSProperties,
  sidebar: {
    width: 220,
    backgroundColor: '#16213e',
    padding: '20px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flexShrink: 0,
  } as React.CSSProperties,
  logo: {
    fontSize: 22,
    fontWeight: 700,
    color: '#e94560',
    padding: '0 20px 20px',
    letterSpacing: 1,
  } as React.CSSProperties,
  navItem: (active: boolean) =>
    ({
      padding: '12px 20px',
      cursor: 'pointer',
      backgroundColor: active ? '#0f3460' : 'transparent',
      borderLeft: active ? '3px solid #e94560' : '3px solid transparent',
      fontSize: 14,
      fontWeight: active ? 600 : 400,
      transition: 'background-color 0.15s, border-color 0.15s',
      userSelect: 'none',
    }) as React.CSSProperties,
  content: {
    flex: 1,
    padding: 32,
    overflowY: 'auto',
  } as React.CSSProperties,
};

export function App() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.logo}>BOILERDECK</div>
        {NAV_ITEMS.map((item) => (
          <div
            key={item.path}
            style={styles.navItem(location.pathname === item.path)}
            onClick={() => navigate(item.path)}
            onMouseEnter={(e) => {
              if (location.pathname !== item.path) {
                e.currentTarget.style.backgroundColor = '#0f3460aa';
              }
            }}
            onMouseLeave={(e) => {
              if (location.pathname !== item.path) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
      <div style={styles.content}>
        <Routes>
          <Route path="/" element={<Store />} />
          <Route path="/library" element={<Library />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </div>
  );
}
