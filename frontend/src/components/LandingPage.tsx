import { useState } from 'react';
import './LandingPage.css';
import { useWallet } from '../context/WalletContext';
import { Wallet, CheckCircle2 } from 'lucide-react';
import FreighterInstallModal from './FreighterInstallModal';
import WalletConnectModal from './WalletConnectModal';

interface LandingPageProps {
  onLaunchApp: () => void;
  onOpenDocs: () => void;
}

export default function LandingPage({ onLaunchApp, onOpenDocs }: LandingPageProps) {
  const { address, isConnected, isConnecting, error, clearError } = useWallet();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const shortenKey = (key: string) => {
    if (!key || key.length < 10) return key;
    return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
  };

  return (
    <div className="landing">

      {/* ── Modern Pop-Up Modals ── */}
      <WalletConnectModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
      <FreighterInstallModal error={error} onDismiss={clearError} />

      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-logo">
          <div className="lp-logo-icon">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.2l5 2.8v5.6L10 15.4 5 12.6V7l5-2.8z" />
            </svg>
          </div>
          <span className="lp-logo-name">Pactum</span>
        </div>
        <div className="lp-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="lp-nav-link" onClick={onOpenDocs}>Docs</button>
          <a className="lp-nav-link" href="https://github.com/amankoli09/Pactum" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a className="lp-nav-link" href="https://stellar.expert/explorer/testnet/contract/CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E" target="_blank" rel="noopener noreferrer">Explorer</a>

          {/* Freighter Wallet Connect Pop-Up Button */}
          {isConnected && address ? (
            <button
              onClick={() => setIsWalletModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#15803d',
                borderRadius: '10px',
                padding: '7px 14px',
                fontWeight: '700',
                fontSize: '12.5px',
                fontFamily: 'monospace',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(34, 197, 94, 0.08)'
              }}
              title="Click to view wallet details"
            >
              <CheckCircle2 size={14} color="#22c55e" />
              {shortenKey(address)}
            </button>
          ) : (
            <button
              onClick={() => setIsWalletModalOpen(true)}
              disabled={isConnecting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px',
                padding: '8px 18px',
                fontSize: '12.5px',
                fontWeight: '700',
                cursor: isConnecting ? 'wait' : 'pointer',
                boxShadow: '0 4px 14px rgba(15, 23, 42, 0.15)',
                transition: 'all 0.15s ease'
              }}
            >
              <Wallet size={15} />
              {isConnecting ? 'Connecting...' : 'Connect Freighter'}
            </button>
          )}

          <button className="lp-btn-primary lp-btn-sm" onClick={onLaunchApp}>Launch App →</button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-badge">
          <span className="lp-badge-dot"></span>
          Live on Stellar Testnet
        </div>
        <h1 className="lp-hero-title">
          On-chain registry<br />
          <span className="lp-hero-accent">for commitments</span><br />
          that matter.
        </h1>
        <p className="lp-hero-sub">
          Pactum records real-world promises between two parties on Soroban —
          who committed, to whom, and whether they followed through.
          Every outcome builds a public, verifiable reputation.
        </p>
        <div className="lp-hero-actions">
          <button className="lp-btn-primary lp-btn-lg" id="hero-launch-btn" onClick={onLaunchApp}>
            Launch App
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
          <button className="lp-btn-ghost lp-btn-lg" onClick={onOpenDocs}>Read the Docs</button>
        </div>

        <div className="lp-contract-pill">
          <span className="lp-contract-label">Contract</span>
          <span className="lp-contract-id">CBADTVTJ6IN...GAA7E</span>
          <a href="https://stellar.expert/explorer/testnet/contract/CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E" target="_blank" rel="noopener noreferrer" className="lp-contract-link">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 1 1 1h9a1 1 0 0 1 1-1v-4" />
              <path d="M14 2H9m5 0v5M8 8l6-6" />
            </svg>
          </a>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="lp-stats">
        <div className="lp-stat"><div className="lp-stat-value">4</div><div className="lp-stat-label">Commitments on-chain</div></div>
        <div className="lp-stat-divider"></div>
        <div className="lp-stat"><div className="lp-stat-value">7d</div><div className="lp-stat-label">Dispute window</div></div>
        <div className="lp-stat-divider"></div>
        <div className="lp-stat"><div className="lp-stat-value">0</div><div className="lp-stat-label">Funds held</div></div>
        <div className="lp-stat-divider"></div>
        <div className="lp-stat"><div className="lp-stat-value">∞</div><div className="lp-stat-label">Addresses queryable</div></div>
      </section>

      {/* ── How it works ── */}
      <section className="lp-section">
        <div className="lp-section-label">How it works</div>
        <h2 className="lp-section-title">A commitment lifecycle in four steps</h2>
        <div className="lp-steps">
          {[
            { n: '01', t: 'Create', d: 'Either party registers the commitment on-chain: issuer, counterparty, terms hash, and due date. Immutable from this point.' },
            { n: '02', t: 'Attest', d: 'After the due date, the issuer or counterparty records the outcome: Fulfilled, Late, or Breached.' },
            { n: '03', t: 'Dispute', d: 'If parties disagree, a 7-day window allows a dispute to be raised. A designated arbitrator then resolves it.' },
            { n: '04', t: 'Reputation', d: "Every resolved outcome feeds the issuer's on-chain reputation score — a permanent, verifiable compliance record." },
          ].map((s, i) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 0, flex: 1 }}>
              <div className="lp-step">
                <div className="lp-step-number">{s.n}</div>
                <div className="lp-step-content">
                  <div className="lp-step-title">{s.t}</div>
                  <div className="lp-step-desc">{s.d}</div>
                </div>
              </div>
              {i < 3 && <div className="lp-step-connector"></div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-copy">
          © 2026 Pactum Protocol. Built on Soroban / Stellar.
        </div>
      </footer>

    </div>
  );
}
