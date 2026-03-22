import React, { useEffect, useState } from 'react';
import {
  getSettings,
  saveSettings,
  getApiKeys,
  saveApiKeys,
} from '../shared/storage';
import { DEFAULT_SETTINGS, VOICE_OPTIONS } from '../shared/constants';
import { ExtensionSettings, DisplayMode, ExplanationLevel, ApiKeys } from '../shared/types';

/* ─── Gear Illustration ─── */

const GearIllustration: React.FC = () => (
  <svg viewBox="0 0 200 160" className="w-40 h-auto mx-auto" aria-hidden="true">
    <defs>
      <radialGradient id="gearGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FF9900" stopOpacity="0.35">
          <animate attributeName="stopOpacity" values="0.35;0.15;0.35" dur="3s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stopColor="#FF9900" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="gearGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FEBD69" />
        <stop offset="100%" stopColor="#FF9900" />
      </linearGradient>
    </defs>
    <circle cx="100" cy="80" r="60" fill="url(#gearGlow)" />
    <g transform="translate(100,80)">
      <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="20s" repeatCount="indefinite" additive="sum" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <rect key={angle} x="-6" y="-38" width="12" height="14" rx="3" fill="url(#gearGrad)" transform={`rotate(${angle})`} opacity="0.8" />
      ))}
      <circle cx="0" cy="0" r="28" fill="none" stroke="url(#gearGrad)" strokeWidth="8" />
      <circle cx="0" cy="0" r="12" fill="#0d1117" stroke="#FF9900" strokeWidth="2" />
      <circle cx="0" cy="0" r="5" fill="#FF9900" opacity="0.5">
        <animate attributeName="opacity" values="0.5;0.25;0.5" dur="2s" repeatCount="indefinite" />
      </circle>
    </g>
  </svg>
);

/* ─── Main Component ─── */

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [capturing, setCapturing] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
    getApiKeys().then(setApiKeys);
  }, []);

  const handleKeyCapture = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (settings) {
      setSettings({ ...settings, shortcutKey: e.key });
      setCapturing(false);
    }
  };

  const handleSave = async () => {
    if (settings) {
      await saveSettings(settings);
      await saveApiKeys(apiKeys);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const handleReset = async () => {
    setSettings({ ...DEFAULT_SETTINGS });
    await saveSettings(DEFAULT_SETTINGS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!settings) {
    return (
      <div className="settings-root">
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Loading...</p>
      </div>
    );
  }

  const displayKey = settings.shortcutKey === '`' ? '`' : settings.shortcutKey;

  return (
    <div className="settings-root">
      <div className="mesh-bg" aria-hidden="true">
        <div className="mesh mesh-1" />
        <div className="mesh mesh-2" />
        <div className="mesh mesh-3" />
        <div className="mesh mesh-4" />
      </div>

      <div className="settings-container">
        <h2 className="settings-header">ScreenSense</h2>

        <div className="card">
          <div className="card-content">
            <GearIllustration />
            <h1 className="card-title"><span className="gradient-text">Settings</span></h1>

            <div className="section-divider">
              <span className="section-title">API Keys</span>
              <p className="field-hint" style={{ marginTop: 4 }}>Required for voice commands to work. Keys are stored locally in your browser.</p>
            </div>

            <div className="field-group">
              <label className="field-label">ElevenLabs API Key <span className="required-badge">required</span></label>
              <input type="password" value={apiKeys.elevenLabsKey || ''} placeholder="sk_..."
                onChange={e => setApiKeys({ ...apiKeys, elevenLabsKey: e.target.value || undefined })}
                className="text-input" />
              <p className="field-hint">Get yours free at <a href="https://elevenlabs.io" target="_blank" rel="noopener" className="field-link">elevenlabs.io</a> — used for speech-to-text and text-to-speech</p>
            </div>

            <div className="field-group">
              <label className="field-label">Groq API Key <span className="optional-badge">optional</span></label>
              <input type="password" value={apiKeys.groqKey || ''} placeholder="gsk_..."
                onChange={e => setApiKeys({ ...apiKeys, groqKey: e.target.value || undefined })}
                className="text-input" />
              <p className="field-hint">Free at <a href="https://console.groq.com/keys" target="_blank" rel="noopener" className="field-link">console.groq.com</a> — fallback speech-to-text</p>
            </div>

            <div className="field-group">
              <label className="field-label">Deepgram API Key <span className="optional-badge">optional</span></label>
              <input type="password" value={apiKeys.deepgramKey || ''} placeholder="your-deepgram-key"
                onChange={e => setApiKeys({ ...apiKeys, deepgramKey: e.target.value || undefined })}
                className="text-input" />
              <p className="field-hint">$200 free credit at <a href="https://console.deepgram.com" target="_blank" rel="noopener" className="field-link">deepgram.com</a> — best accuracy STT</p>
            </div>

            <div className="section-divider">
              <span className="section-title">Preferences</span>
            </div>

            <div className="field-group">
              <label className="field-label">Shortcut Key</label>
              {capturing ? (
                <div className="key-capture" tabIndex={0} onKeyDown={handleKeyCapture} onBlur={() => setCapturing(false)} autoFocus ref={(el) => el?.focus()}>
                  Press any key...
                </div>
              ) : (
                <button onClick={() => setCapturing(true)} className="key-display">
                  <kbd className="key-badge">{displayKey}</kbd>
                  <span className="key-hint">(click to change)</span>
                </button>
              )}
            </div>

            <div className="field-group">
              <label className="field-label">Hold Delay: <span className="field-value">{settings.holdDelayMs}ms</span></label>
              <input type="range" min={100} max={500} step={10} value={settings.holdDelayMs}
                onChange={(e) => setSettings({ ...settings, holdDelayMs: parseInt(e.target.value, 10) })} className="range-input" />
              <div className="range-labels"><span>100ms</span><span>500ms</span></div>
            </div>

            <div className="field-group">
              <label className="field-label">Display Mode</label>
              <div className="toggle-group">
                {([['both', 'Text + Audio'], ['audio-only', 'Audio Only'], ['text-only', 'Text Only']] as [DisplayMode, string][]).map(([mode, label]) => (
                  <button key={mode} className={`toggle-btn${settings.displayMode === mode ? ' active' : ''}`}
                    onClick={() => setSettings({ ...settings, displayMode: mode })}>{label}</button>
                ))}
              </div>
              <p className="field-hint">Choose how responses are delivered — text overlay, spoken audio, or both</p>
            </div>

            <div className="field-group">
              <label className="field-label">Explanation Level</label>
              <div className="toggle-group level-group">
                {([['kid', 'Kid'], ['school', 'Student'], ['college', 'College'], ['phd', 'PhD'], ['executive', 'Executive']] as [ExplanationLevel, string][]).map(([level, label]) => (
                  <button key={level} className={`toggle-btn${settings.explanationLevel === level ? ' active' : ''}`}
                    onClick={() => setSettings({ ...settings, explanationLevel: level })}>{label}</button>
                ))}
              </div>
              <p className="field-hint">Adjusts how detailed and technical the AI explanations are</p>
            </div>

            <div className="field-group">
              <label className="field-label">Voice ID</label>
              <select
                value={settings.voiceId}
                onChange={e => setSettings(prev => ({ ...prev!, voiceId: e.target.value }))}
                className="select-input"
              >
                {VOICE_OPTIONS.map(voice => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} — {voice.description}
                  </option>
                ))}
              </select>
              <p className="field-hint">Choose a voice for spoken responses</p>
            </div>

            <div className="field-group">
              <label className="field-label">Speech-to-Text Provider</label>
              <select
                value={settings.sttProvider || 'elevenlabs'}
                onChange={e => setSettings(prev => ({ ...prev!, sttProvider: e.target.value as any }))}
                className="select-input"
              >
                <option value="elevenlabs">ElevenLabs Scribe (recommended)</option>
                <option value="deepgram">Deepgram Nova-3 (best accuracy)</option>
                <option value="groq">Groq Whisper (free tier)</option>
              </select>
              <p className="field-hint">Choose which speech recognition service processes your voice commands</p>
            </div>

            <div className="field-group">
              <label className="field-label">TTS Model</label>
              <div className="toggle-group">
                {([['eleven_flash_v2_5', 'Flash v2.5 (fast)'], ['eleven_multilingual_v2', 'Multilingual v2']] as [string, string][]).map(([model, label]) => (
                  <button key={model} className={`toggle-btn${settings.ttsModel === model ? ' active' : ''}`}
                    onClick={() => setSettings({ ...settings, ttsModel: model })}>{label}</button>
                ))}
              </div>
              <p className="field-hint">Flash v2.5 is faster; Multilingual v2 supports more languages</p>
            </div>

            <div className="actions">
              <button onClick={handleSave} className="btn btn-primary">
                {saved ? (
                  <><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" style={{ marginRight: 8 }}>
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>Saved!</>
                ) : 'Save Changes'}
              </button>
              <button onClick={handleReset} className="btn-ghost">Reset to Defaults</button>
            </div>
          </div>
        </div>

        <p className="footer-text">ScreenSense Voice</p>
      </div>

      <style>{`
        .settings-root {
          min-height: 100vh;
          background: #0d1117;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          position: relative;
          overflow: hidden;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .mesh-bg { position: absolute; inset: 0; overflow: hidden; }
        .mesh { position: absolute; border-radius: 50%; filter: blur(120px); opacity: 0.7; }
        .mesh-1 { width: 600px; height: 600px; background: radial-gradient(circle, #1a3a5c 0%, transparent 70%); top: -200px; left: -100px; animation: meshDrift1 20s ease-in-out infinite; }
        .mesh-2 { width: 500px; height: 500px; background: radial-gradient(circle, #2d1b4e 0%, transparent 70%); bottom: -150px; right: -50px; animation: meshDrift2 25s ease-in-out infinite; }
        .mesh-3 { width: 400px; height: 400px; background: radial-gradient(circle, rgba(255,153,0,0.15) 0%, transparent 70%); top: 30%; right: 10%; animation: meshDrift3 18s ease-in-out infinite; }
        .mesh-4 { width: 350px; height: 350px; background: radial-gradient(circle, #0f2b46 0%, transparent 70%); bottom: 20%; left: 5%; animation: meshDrift4 22s ease-in-out infinite; }
        @keyframes meshDrift1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(80px,60px) scale(1.1); } }
        @keyframes meshDrift2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-60px,-40px) scale(1.05); } }
        @keyframes meshDrift3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-50px,60px) scale(1.15); } }
        @keyframes meshDrift4 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-50px) scale(1.08); } }

        .settings-container { width: 100%; max-width: 480px; position: relative; z-index: 1; }

        .settings-header {
          text-align: center; font-size: 24px; font-weight: 800;
          letter-spacing: -0.04em; color: #FF9900;
          margin: 0 0 2rem;
          text-shadow: 0 0 40px rgba(255, 153, 0, 0.3);
        }

        .card {
          background: rgba(255,255,255,0.05);
          backdrop-filter: blur(40px) saturate(1.5);
          -webkit-backdrop-filter: blur(40px) saturate(1.5);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 28px;
          padding: 2.5rem 2rem;
          box-shadow: 0 0 0 0.5px rgba(255,255,255,0.05), 0 32px 64px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .card-content { text-align: center; }

        .card-title { font-size: 28px; font-weight: 800; color: #fff; margin: 0.5rem 0 1.75rem; letter-spacing: -0.04em; }
        .gradient-text { background: linear-gradient(135deg, #FF9900, #FEBD69); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }

        .field-group { text-align: left; margin-bottom: 1.5rem; }
        .field-label { display: block; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.35); margin-bottom: 8px; letter-spacing: 0.08em; text-transform: uppercase; }
        .field-value { color: #FF9900; text-transform: none; }

        .key-display {
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
          padding: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px; cursor: pointer; transition: all 0.3s ease;
        }
        .key-display:hover { background: rgba(255,153,0,0.06); border-color: rgba(255,153,0,0.2); }
        .key-badge {
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255,153,0,0.15); border: 1px solid rgba(255,153,0,0.3);
          border-radius: 6px; padding: 2px 12px;
          font-family: 'SF Mono', 'Fira Code', monospace; font-size: 16px; font-weight: 600;
          color: #FF9900; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .key-hint { font-size: 13px; color: rgba(255,255,255,0.2); }
        .key-capture {
          width: 100%; padding: 14px; background: rgba(255,153,0,0.06);
          border: 2px solid rgba(255,153,0,0.4); border-radius: 14px;
          text-align: center; font-size: 14px; font-weight: 500; color: #FF9900; outline: none;
          animation: pulseCapture 1.5s ease-in-out infinite;
        }
        @keyframes pulseCapture { 0%,100% { border-color: rgba(255,153,0,0.4); } 50% { border-color: rgba(255,153,0,0.7); } }

        .range-input {
          width: 100%; height: 6px; border-radius: 6px; background: rgba(255,255,255,0.06);
          -webkit-appearance: none; appearance: none; outline: none; cursor: pointer;
        }
        .range-input::-webkit-slider-thumb {
          -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%;
          background: #FF9900; box-shadow: 0 2px 10px rgba(255,153,0,0.5);
          cursor: pointer; transition: transform 0.2s ease;
        }
        .range-input::-webkit-slider-thumb:hover { transform: scale(1.15); }
        .range-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: rgba(255,255,255,0.15); }

        .text-input {
          width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08); border-radius: 14px;
          font-size: 14px; font-family: 'SF Mono', 'Fira Code', monospace;
          color: rgba(255,255,255,0.9); outline: none; transition: all 0.3s ease; box-sizing: border-box;
        }
        .text-input::placeholder { color: rgba(255,255,255,0.15); }
        .text-input:focus { border-color: rgba(255,153,0,0.4); background: rgba(255,153,0,0.04); box-shadow: 0 0 0 3px rgba(255,153,0,0.1); }

        .select-input {
          width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08); border-radius: 14px;
          font-size: 14px; color: rgba(255,255,255,0.9); outline: none;
          transition: all 0.3s ease; box-sizing: border-box;
          -webkit-appearance: none; appearance: none; cursor: pointer;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23FF9900' d='M1.41 0L6 4.58 10.59 0 12 1.41l-6 6-6-6z'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 16px center;
        }
        .select-input option { background: #1a1f2e; color: rgba(255,255,255,0.9); }
        .select-input:focus { border-color: rgba(255,153,0,0.4); background-color: rgba(255,153,0,0.04); box-shadow: 0 0 0 3px rgba(255,153,0,0.1); }

        .field-hint { margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.2); }
        .field-link { color: rgba(255,153,0,0.7); text-decoration: none; transition: color 0.2s; }
        .field-link:hover { color: #FF9900; text-decoration: underline; }

        .section-divider { margin: 2rem 0 1.25rem; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); text-align: left; }
        .section-title { font-size: 13px; font-weight: 700; color: rgba(255,153,0,0.8); letter-spacing: 0.05em; text-transform: uppercase; }
        .required-badge { font-size: 9px; font-weight: 600; color: #FF9900; background: rgba(255,153,0,0.15); padding: 2px 6px; border-radius: 4px; margin-left: 6px; text-transform: none; letter-spacing: normal; }
        .optional-badge { font-size: 9px; font-weight: 600; color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; margin-left: 6px; text-transform: none; letter-spacing: normal; }

        .toggle-group {
          display: flex; gap: 4px; background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 4px;
        }
        .level-group { flex-wrap: wrap; }
        .toggle-btn {
          flex: 1; padding: 10px 8px; background: transparent;
          border: 1px solid transparent; border-radius: 10px;
          font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.25);
          cursor: pointer; transition: all 0.2s ease; white-space: nowrap;
        }
        .toggle-btn:hover { color: rgba(255,255,255,0.45); background: rgba(255,255,255,0.03); }
        .toggle-btn.active {
          background: rgba(255,153,0,0.15); border-color: rgba(255,153,0,0.3);
          color: #FF9900; font-weight: 600;
        }

        .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 0.5rem 0 1.5rem; }

        .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 2rem; }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 100%; padding: 15px 24px; border: none; border-radius: 16px;
          font-size: 15px; font-weight: 700; cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
          position: relative; overflow: hidden; letter-spacing: -0.01em;
        }
        .btn::before {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 50%);
          opacity: 0; transition: opacity 0.3s;
        }
        .btn:hover::before { opacity: 1; }
        .btn-primary {
          background: #FF9900; color: #fff;
          box-shadow: 0 4px 20px rgba(255,153,0,0.4), 0 0 0 1px rgba(255,153,0,0.5) inset;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(255,153,0,0.5), 0 0 0 1px rgba(255,153,0,0.5) inset; }
        .btn-primary:active { transform: translateY(0); }
        .btn-ghost {
          background: none; border: none; padding: 10px; font-size: 13px; font-weight: 500;
          color: rgba(255,255,255,0.2); cursor: pointer; transition: color 0.3s;
        }
        .btn-ghost:hover { color: rgba(255,255,255,0.4); }

        .footer-text { text-align: center; font-size: 12px; color: rgba(255,255,255,0.2); margin-top: 2rem; letter-spacing: 0.05em; }
      `}</style>
    </div>
  );
};

export default Settings;
