import React, { useState, useEffect, useCallback } from 'react';
import { getSettings, setMicPermissionGranted, setSetupComplete } from '../shared/storage';
import { ExtensionSettings } from '../shared/types';

type WelcomeStep = 1 | 2 | 3;

/* ─── Animated SVG Illustrations ─── */

const KeyboardIllustration: React.FC = () => (
  <svg viewBox="0 0 200 140" className="w-48 h-auto mx-auto" aria-hidden="true">
    <defs>
      <radialGradient id="keyGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45">
          <animate attributeName="stopOpacity" values="0.45;0.2;0.45" dur="2s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
      </linearGradient>
    </defs>
    <circle cx="100" cy="70" r="60" fill="url(#keyGlow)" />
    <rect x="20" y="40" width="160" height="80" rx="12" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
    {[0, 1, 2].map((row) =>
      Array.from({ length: 8 }).map((_, col) => {
        const isBacktick = row === 0 && col === 0;
        return (
          <rect key={`${row}-${col}`} x={30 + col * 18} y={50 + row * 22} width={14} height={14} rx={3}
            fill={isBacktick ? '#FFFFFF' : 'rgba(255,255,255,0.08)'} opacity={isBacktick ? 1 : 0.6}>
            {isBacktick && <animate attributeName="opacity" values="1;0.6;1" dur="1.5s" repeatCount="indefinite" />}
          </rect>
        );
      })
    )}
    <text x="37" y="61" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="monospace" fontWeight="bold">`</text>
    <g>
      <animateTransform attributeName="transform" type="translate" values="0,-8; 0,0; 0,-8" dur="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" />
      <circle cx="37" cy="42" r="6" fill="#E0E0E0" opacity="0.4" />
      <circle cx="37" cy="42" r="3" fill="#FFFFFF" opacity="0.7" />
    </g>
    <circle cx="37" cy="57" r="8" fill="none" stroke="#FFFFFF" strokeWidth="1" opacity="0">
      <animate attributeName="r" values="8;24" dur="2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.5;0" dur="2s" repeatCount="indefinite" />
    </circle>
  </svg>
);

const MicrophoneIllustration: React.FC<{ granted: boolean }> = ({ granted }) => (
  <svg viewBox="0 0 200 180" className="w-48 h-auto mx-auto" aria-hidden="true">
    <defs>
      <radialGradient id="micGlow" cx="50%" cy="40%" r="50%">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.35">
          <animate attributeName="stopOpacity" values="0.35;0.15;0.35" dur="2s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="micBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={granted ? '#E0E0E0' : '#F0F0F0'} />
        <stop offset="100%" stopColor={granted ? '#FFFFFF' : '#D0D0D0'} />
      </linearGradient>
    </defs>
    <circle cx="100" cy="80" r="70" fill="url(#micGlow)" />
    {[30, 42, 54].map((r, i) => (
      <React.Fragment key={i}>
        <path d={`M${100 - r} 70 Q${100 - r} ${70 - r * 0.6} 100 ${70 - r * 0.6} Q${100 + r} ${70 - r * 0.6} ${100 + r} 70`}
          fill="none" stroke={granted ? '#E0E0E0' : '#FFFFFF'} strokeWidth="1.5" strokeLinecap="round" opacity="0">
          <animate attributeName="opacity" values="0;0.5;0" dur="2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
        </path>
      </React.Fragment>
    ))}
    <rect x="88" y="55" width="24" height="45" rx="12" fill="url(#micBody)" />
    {[63, 69, 75, 81, 87].map((y) => (
      <line key={y} x1="92" y1={y} x2="108" y2={y} stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />
    ))}
    <path d="M80 95 Q80 115 100 115 Q120 115 120 95" fill="none" stroke={granted ? '#E0E0E0' : '#F0F0F0'} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="100" y1="115" x2="100" y2="135" stroke={granted ? '#E0E0E0' : '#F0F0F0'} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="88" y1="135" x2="112" y2="135" stroke={granted ? '#E0E0E0' : '#F0F0F0'} strokeWidth="2.5" strokeLinecap="round" />
    {granted && (
      <g>
        <circle cx="130" cy="60" r="14" fill="#FFFFFF" />
        <polyline points="122,60 128,66 138,54" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" strokeDashoffset="24">
          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="0.4s" fill="freeze" />
        </polyline>
      </g>
    )}
  </svg>
);

const RocketIllustration: React.FC = () => (
  <svg viewBox="0 0 200 200" className="w-48 h-auto mx-auto" aria-hidden="true">
    <defs>
      <radialGradient id="launchGlow" cx="50%" cy="60%" r="50%">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.25">
          <animate attributeName="stopOpacity" values="0.25;0.1;0.25" dur="3s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rocketBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#e8e0d5" />
        <stop offset="100%" stopColor="#E0E0E0" />
      </linearGradient>
      <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="100%" stopColor="#e74c3c" />
      </linearGradient>
    </defs>
    <circle cx="100" cy="100" r="80" fill="url(#launchGlow)" />
    {[[30, 40], [160, 50], [45, 150], [155, 140], [80, 30], [130, 170], [25, 100], [175, 90]].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r="1.5" fill="rgba(255,255,255,0.6)">
        <animate attributeName="opacity" values="0.2;1;0.2" dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
      </circle>
    ))}
    <g>
      <animateTransform attributeName="transform" type="translate" values="0,4; 0,-4; 0,4" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" />
      <ellipse cx="100" cy="145" rx="8" ry="18" fill="url(#flame)" opacity="0.9">
        <animate attributeName="ry" values="18;22;16;20;18" dur="0.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.9;0.6;0.9" dur="0.3s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="100" cy="143" rx="4" ry="12" fill="#E0E0E0" opacity="0.8">
        <animate attributeName="ry" values="12;15;10;13;12" dur="0.4s" repeatCount="indefinite" />
      </ellipse>
      <path d="M88 130 L88 95 Q88 65 100 55 Q112 65 112 95 L112 130 Z" fill="url(#rocketBody)" />
      <circle cx="100" cy="95" r="8" fill="#1a2332" stroke="#E0E0E0" strokeWidth="1.5" />
      <circle cx="100" cy="95" r="5" fill="#232F3E">
        <animate attributeName="fill" values="#232F3E;#37475A;#232F3E" dur="2s" repeatCount="indefinite" />
      </circle>
      <path d="M88 120 L75 138 L88 132 Z" fill="#FFFFFF" />
      <path d="M112 120 L125 138 L112 132 Z" fill="#FFFFFF" />
      <path d="M95 70 Q95 60 100 55" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.5" strokeLinecap="round" />
    </g>
    {[0, 1, 2, 3, 4].map((i) => (
      <circle key={`p${i}`} cx={95 + Math.random() * 10} cy="160" r="2" fill="#FFFFFF" opacity="0">
        <animate attributeName="cy" values="155;185" dur="1s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.7;0" dur="1s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
        <animate attributeName="cx" values={`${96 + i * 2};${90 + i * 4}`} dur="1s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
      </circle>
    ))}
  </svg>
);

/* ─── Main Component ─── */

const Welcome: React.FC = () => {
  const [step, setStep] = useState<WelcomeStep>(1);
  const [prevStep, setPrevStep] = useState<WelcomeStep>(1);
  const [animating, setAnimating] = useState(false);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [micGranted, setMicGranted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => { getSettings().then(setSettings); }, []);

  const goToStep = useCallback((next: WelcomeStep) => {
    if (animating) return;
    setAnimating(true);
    setPrevStep(step);
    setStep(next);
    setTimeout(() => setAnimating(false), 600);
  }, [step, animating]);

  const handleRequestMic = async () => {
    setRequesting(true);
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicGranted(true);
      await setMicPermissionGranted(true);
    } catch {
      setMicError('Microphone access was denied. Please allow it to continue.');
    } finally {
      setRequesting(false);
    }
  };

  const handleFinish = async () => { await setSetupComplete(); window.close(); };

  const shortcutKey = settings?.shortcutKey === '`' ? '`' : settings?.shortcutKey ?? '`';

  return (
    <div className="welcome-root">
      {/* Mesh gradient blobs */}
      <div className="mesh-bg" aria-hidden="true">
        <div className="mesh mesh-1" />
        <div className="mesh mesh-2" />
        <div className="mesh mesh-3" />
        <div className="mesh mesh-4" />
      </div>

      <div className="welcome-container">
        <h2 className="welcome-title">ScreenSense</h2>

        {/* Progress */}
        <div className="progress-bar">
          {[1, 2, 3].map((s) => (
            <React.Fragment key={s}>
              {s > 1 && <div className={`progress-line ${s <= step ? 'filled' : ''}`} />}
              <div className={`progress-dot ${s === step ? 'active' : ''} ${s < step ? 'done' : ''}`}>
                {s < step ? (
                  <svg viewBox="0 0 16 16" width="12" height="12">
                    <polyline points="3,8 7,12 13,4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : s}
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Glass Card */}
        <div className="card">
          <div key={step} className="card-content step-enter">
            {step === 1 && (
              <>
                <KeyboardIllustration />
                <h1 className="card-title">Hold to <span className="gradient-text">Speak</span></h1>
                <p className="card-desc">
                  Press and hold <kbd className="key-badge">{shortcutKey}</kbd> to ask a question about anything on your screen. Release when you're done.
                </p>
                <div className="hint-box">
                  <div className="hint-icon">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span>Quick taps are ignored — you can still type normally</span>
                </div>
                <button onClick={() => goToStep(2)} className="btn btn-primary">
                  Continue
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 ml-2">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <MicrophoneIllustration granted={micGranted} />
                <h1 className="card-title">Enable <span className="gradient-text">Microphone</span></h1>
                <p className="card-desc">ScreenSense only listens while you hold the key. Your audio is never stored or sent anywhere except to process your question.</p>
                {micError && (
                  <div className="error-box">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <span>{micError}</span>
                  </div>
                )}
                {micGranted ? (
                  <div className="success-box">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    <span>Microphone access granted</span>
                  </div>
                ) : (
                  <button onClick={handleRequestMic} disabled={requesting} className="btn btn-mic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 mr-2">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2" strokeLinecap="round" />
                      <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
                      <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
                    </svg>
                    {requesting ? 'Requesting Access...' : 'Allow Microphone'}
                  </button>
                )}
                <button onClick={() => goToStep(3)} disabled={!micGranted} className={`btn ${micGranted ? 'btn-primary' : 'btn-disabled'}`}>
                  {micGranted ? 'Continue' : 'Grant permission to continue'}
                  {micGranted && <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 ml-2"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>}
                </button>
              </>
            )}

            {step === 3 && (
              <>
                <RocketIllustration />
                <h1 className="card-title">You're <span className="gradient-text">Ready</span></h1>
                <p className="card-desc">
                  Hold <kbd className="key-badge">{shortcutKey}</kbd>, speak your question, release — and get an instant AI-powered answer right on the page.
                </p>
                <div className="how-it-works">
                  <div className="how-step">
                    <div className="how-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                        <rect x="2" y="7" width="20" height="12" rx="2" />
                        <rect x="5" y="10" width="4" height="3" rx="1" fill="currentColor" opacity="0.3" />
                      </svg>
                    </div>
                    <div className="how-label">Press & hold <kbd className="key-badge-sm">{shortcutKey}</kbd></div>
                  </div>
                  <div className="how-connector" />
                  <div className="how-step">
                    <div className="how-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                        <path d="M19 10v2a7 7 0 01-14 0v-2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="how-label">Speak your mind</div>
                  </div>
                  <div className="how-connector" />
                  <div className="how-step">
                    <div className="how-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="how-label">Instant AI insight</div>
                  </div>
                </div>
                <button onClick={handleFinish} className="btn btn-launch">
                  Launch ScreenSense
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 ml-2">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        <p className="footer-text">ScreenSense Voice</p>
      </div>

      <style>{`
        .welcome-root {
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

        /* ─── Mesh gradient background ─── */
        .mesh-bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }
        .mesh {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.7;
        }
        .mesh-1 {
          width: 600px; height: 600px;
          background: radial-gradient(circle, #1a3a5c 0%, transparent 70%);
          top: -200px; left: -100px;
          animation: meshDrift1 20s ease-in-out infinite;
        }
        .mesh-2 {
          width: 500px; height: 500px;
          background: radial-gradient(circle, #2d1b4e 0%, transparent 70%);
          bottom: -150px; right: -50px;
          animation: meshDrift2 25s ease-in-out infinite;
        }
        .mesh-3 {
          width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 70%);
          top: 30%; right: 10%;
          animation: meshDrift3 18s ease-in-out infinite;
        }
        .mesh-4 {
          width: 350px; height: 350px;
          background: radial-gradient(circle, #0f2b46 0%, transparent 70%);
          bottom: 20%; left: 5%;
          animation: meshDrift4 22s ease-in-out infinite;
        }
        @keyframes meshDrift1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(80px,60px) scale(1.1); } }
        @keyframes meshDrift2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-60px,-40px) scale(1.05); } }
        @keyframes meshDrift3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-50px,60px) scale(1.15); } }
        @keyframes meshDrift4 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-50px) scale(1.08); } }

        .welcome-container {
          width: 100%;
          max-width: 480px;
          position: relative;
          z-index: 1;
        }

        .welcome-title {
          text-align: center;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.04em;
          color: #FFFFFF;
          margin: 0 0 1.5rem;
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.3);
        }

        /* ─── Progress ─── */
        .progress-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 2rem;
          padding: 0 1rem;
        }
        .progress-line {
          flex: 0 0 60px;
          height: 2px;
          background: rgba(255,255,255,0.08);
          border-radius: 2px;
          transition: background 0.5s ease;
        }
        .progress-line.filled {
          background: linear-gradient(90deg, #FFFFFF, #E0E0E0);
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
        }
        .progress-dot {
          width: 34px; height: 34px;
          border-radius: 50%;
          background: rgba(255,255,255,0.04);
          border: 2px solid rgba(255,255,255,0.08);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.2);
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
          backdrop-filter: blur(10px);
        }
        .progress-dot.active {
          background: #FFFFFF;
          border-color: rgba(255, 255, 255, 0.6);
          color: #0d1117;
          box-shadow: 0 0 24px rgba(255, 255, 255, 0.5), 0 0 8px rgba(255, 255, 255, 0.3);
          transform: scale(1.1);
        }
        .progress-dot.done {
          background: rgba(255, 255, 255, 0.2);
          border-color: rgba(255, 255, 255, 0.4);
          color: #FFFFFF;
        }

        /* ─── Glass Card ─── */
        .card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(40px) saturate(1.5);
          -webkit-backdrop-filter: blur(40px) saturate(1.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 28px;
          padding: 2.5rem 2rem;
          box-shadow:
            0 0 0 0.5px rgba(255, 255, 255, 0.05),
            0 32px 64px rgba(0, 0, 0, 0.4),
            0 8px 24px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }
        .card-content { text-align: center; }

        .step-enter {
          animation: stepIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes stepIn {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .card-title {
          font-size: 30px; font-weight: 800; color: #fff;
          margin: 0.5rem 0 0.75rem; letter-spacing: -0.04em;
          line-height: 1.2;
        }
        .gradient-text {
          background: linear-gradient(135deg, #FFFFFF, #E0E0E0);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .card-desc {
          font-size: 15px; line-height: 1.65;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 1.5rem;
          max-width: 380px;
          margin-left: auto; margin-right: auto;
        }

        .key-badge {
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255, 255, 255, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 6px;
          padding: 2px 10px;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 15px; font-weight: 600;
          color: #FFFFFF;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .key-badge-sm {
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255, 255, 255, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          padding: 1px 6px;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 12px; font-weight: 600;
          color: #FFFFFF;
        }

        .hint-box {
          display: flex; align-items: center; gap: 10px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          padding: 12px 16px;
          margin-bottom: 1.5rem;
          font-size: 13px; color: rgba(255, 255, 255, 0.7);
        }
        .hint-icon { color: #FFFFFF; flex-shrink: 0; opacity: 0.5; }

        /* ─── Buttons ─── */
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 100%; padding: 15px 24px;
          border: none; border-radius: 16px;
          font-size: 15px; font-weight: 700;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative; overflow: hidden;
          letter-spacing: -0.01em;
        }
        .btn::before {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 50%);
          opacity: 0;
          transition: opacity 0.3s;
        }
        .btn:hover::before { opacity: 1; }

        .btn-primary {
          background: #FFFFFF;
          color: #0d1117;
          box-shadow: 0 4px 20px rgba(255, 255, 255, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
        }
        .btn-primary:active { transform: translateY(0); }

        .btn-mic {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.25);
          color: #FFFFFF;
          margin-bottom: 0.75rem;
          backdrop-filter: blur(10px);
        }
        .btn-mic:hover {
          background: rgba(255, 255, 255, 0.18);
          border-color: rgba(255, 255, 255, 0.4);
        }
        .btn-mic:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-disabled {
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.2);
          cursor: not-allowed;
          border: 1px solid rgba(255,255,255,0.06);
        }

        .btn-launch {
          background: #FFFFFF;
          color: #0d1117;
          box-shadow: 0 4px 24px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
          font-size: 16px;
          padding: 16px 24px;
        }
        .btn-launch:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 36px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
        }

        .error-box {
          display: flex; align-items: center; gap: 8px;
          background: rgba(255, 69, 58, 0.1);
          border: 1px solid rgba(255, 69, 58, 0.2);
          border-radius: 14px;
          padding: 12px 16px;
          margin-bottom: 1rem;
          font-size: 13px; color: #ff6b6b;
        }
        .success-box {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 14px;
          padding: 12px 16px;
          margin-bottom: 1rem;
          font-size: 14px; font-weight: 600; color: #FFFFFF;
          animation: successPop 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes successPop {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }

        .how-it-works {
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 2rem;
        }
        .how-step {
          display: flex; flex-direction: column; align-items: center; gap: 10px;
          padding: 16px 12px;
        }
        .how-icon {
          width: 48px; height: 48px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          color: #FFFFFF;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
        }
        .how-step:hover .how-icon {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.3);
          transform: translateY(-3px);
          box-shadow: 0 8px 20px rgba(255, 255, 255, 0.15);
        }
        .how-label {
          font-size: 12px; font-weight: 500;
          color: rgba(255,255,255,0.35);
          white-space: nowrap;
        }
        .how-connector {
          width: 28px; height: 1px;
          background: rgba(255, 255, 255, 0.15);
          margin-bottom: 28px;
          flex-shrink: 0;
        }

        .footer-text {
          text-align: center;
          font-size: 12px;
          color: rgba(255,255,255,0.2);
          margin-top: 2rem;
          letter-spacing: 0.05em;
        }
      `}</style>
    </div>
  );
};

export default Welcome;
