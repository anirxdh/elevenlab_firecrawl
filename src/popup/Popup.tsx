import React, { useEffect, useState } from 'react';
import { getSettings, isMicPermissionGranted, isSetupComplete } from '../shared/storage';
import { ExtensionSettings } from '../shared/types';

const Popup: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);

  useEffect(() => {
    getSettings().then(setSettings);
    isMicPermissionGranted().then(setMicGranted);
    isSetupComplete().then(setSetupDone);
  }, []);

  const openSettings = () => { chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') }); };
  const openWelcome = () => { chrome.runtime.sendMessage({ action: 'open-welcome' }); window.close(); };

  const shortcutDisplay = settings?.shortcutKey === '`' ? 'Backtick (`)' : settings?.shortcutKey ?? '...';

  if (settings === null || micGranted === null || setupDone === null) {
    return <div style={styles.root}><p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Loading...</p></div>;
  }

  return (
    <div style={styles.root}>
      {/* Subtle mesh blobs */}
      <div style={styles.meshBg}>
        <div style={{ ...styles.meshBlob, width: 200, height: 200, background: 'radial-gradient(circle, rgba(26,58,92,0.6) 0%, transparent 70%)', top: -60, left: -40 }} />
        <div style={{ ...styles.meshBlob, width: 180, height: 180, background: 'radial-gradient(circle, rgba(45,27,78,0.4) 0%, transparent 70%)', bottom: -40, right: -30 }} />
        <div style={{ ...styles.meshBlob, width: 120, height: 120, background: 'radial-gradient(circle, rgba(255,153,0,0.1) 0%, transparent 70%)', top: '40%', right: '10%' }} />
      </div>

      <div style={styles.glass}>
        <div style={styles.header}>
          <img src={chrome.runtime.getURL('icons/icon-48.png')} alt="" style={{ width: 28, height: 28, borderRadius: 8 }} />
          <h1 style={styles.title}>ScreenSense</h1>
        </div>

        {!setupDone && (
          <div style={styles.alertBox}>
            <p style={styles.alertText}>Setup not complete</p>
            <button onClick={openWelcome} style={styles.alertLink}>Complete setup &rarr;</button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={styles.row}>
            <span style={styles.label}>Shortcut</span>
            <span style={styles.keyBadge}>{shortcutDisplay}</span>
          </div>

          <div style={styles.row}>
            <span style={styles.label}>Microphone</span>
            {micGranted ? (
              <span style={styles.granted}>{'\u2713'} Granted</span>
            ) : (
              <button onClick={openWelcome} style={styles.denied}>{'\u2717'} Not granted</button>
            )}
          </div>

          <div style={styles.divider} />

          <button
            onClick={openSettings}
            style={styles.settingsBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,153,0,0.1)';
              e.currentTarget.style.color = '#FF9900';
              e.currentTarget.style.borderColor = 'rgba(255,153,0,0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
            }}
          >
            Settings
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: 288,
    padding: 14,
    background: '#0d1117',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    position: 'relative',
    overflow: 'hidden',
  },
  meshBg: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none' as const,
  },
  meshBlob: {
    position: 'absolute' as const,
    borderRadius: '50%',
    filter: 'blur(60px)',
  },
  glass: {
    position: 'relative' as const,
    zIndex: 1,
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(40px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 18,
    padding: '16px 14px',
    boxShadow: '0 0 0 0.5px rgba(255,255,255,0.05), 0 12px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: 800,
    margin: 0,
    color: '#FF9900',
    letterSpacing: '-0.03em',
  },
  alertBox: {
    background: 'rgba(255,153,0,0.08)',
    border: '1px solid rgba(255,153,0,0.18)',
    borderRadius: 12,
    padding: '10px 14px',
    marginBottom: 14,
  },
  alertText: {
    color: '#FEBD69',
    fontSize: 13,
    margin: '0 0 6px',
    fontWeight: 600,
  },
  alertLink: {
    background: 'none',
    border: 'none',
    color: '#FF9900',
    fontSize: 13,
    cursor: 'pointer',
    padding: 0,
    fontWeight: 700,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
  },
  keyBadge: {
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 13,
    fontWeight: 600,
    color: '#FF9900',
    background: 'rgba(255,153,0,0.12)',
    border: '1px solid rgba(255,153,0,0.25)',
    borderRadius: 6,
    padding: '2px 10px',
  },
  granted: {
    fontSize: 13,
    color: '#FF9900',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  denied: {
    background: 'none',
    border: 'none',
    fontSize: 13,
    color: '#ff6b6b',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  divider: {
    height: 1,
    background: 'rgba(255,255,255,0.06)',
  },
  settingsBtn: {
    width: '100%',
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '10px 0',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};

export default Popup;
