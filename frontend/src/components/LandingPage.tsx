import './LandingPage.css';

interface LandingPageProps {
  onLaunchApp: () => void;
  onOpenDocs: () => void;
}

export default function LandingPage({ onLaunchApp, onOpenDocs }: LandingPageProps) {
  return (
    <div className="landing">

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
        <div className="lp-nav-links">
          <button className="lp-nav-link" onClick={onOpenDocs}>Docs</button>
          <a className="lp-nav-link" href="https://github.com/amankoli09/Pactum" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a className="lp-nav-link" href="https://stellar.expert/explorer/testnet/contract/CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E" target="_blank" rel="noopener noreferrer">Explorer</a>
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
              <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-4" />
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

      {/* ── Features ── */}
      <section className="lp-section">
        <div className="lp-section-label">Why Pactum</div>
        <h2 className="lp-section-title">Trust infrastructure for any agreement</h2>
        <div className="lp-features">
          {[
            { icon: 'M12 2L4 7v10l8 5 8-5V7L12 2z', title: 'No funds held', desc: 'Pactum is a pure registry — it records promises, not payments. No custody risk, no escrow complexity.' },
            { icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', title: 'Per-address reputation', desc: 'Every commitment outcome contributes to a public score — query any address before entering a deal.' },
            { icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', title: 'Dispute resolution', desc: 'Contested outcomes go to a designated arbitrator. The final resolution is what gets recorded.' },
            { icon: 'M16 18l6-6-6-6M8 6L2 12l6 6', title: 'SDK + REST API', desc: 'Any platform can query reputation via a lightweight JS/TS SDK or REST API — one call.' },
            { icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2', title: 'Commitment templates', desc: 'Coming soon: structured templates for refunds, SLAs, milestone check-ins, and recurring reports.' },
            { icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 6v6l4 2', title: 'Oracle auto-attestation', desc: 'Coming soon: oracle-based automatic attestation for measurable commitments like uptime feeds.' },
          ].map((f) => (
            <div className="lp-feature-card" key={f.title}>
              <div className="lp-feature-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
              </div>
              <div className="lp-feature-title">{f.title}</div>
              <div className="lp-feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section className="lp-section">
        <div className="lp-section-label">Built with</div>
        <h2 className="lp-section-title">Soroban-native from the ground up</h2>
        <div className="lp-stack">
          {[
            { name: 'Rust', sub: 'Smart Contract' },
            { name: 'Soroban', sub: 'Stellar SDK' },
            { name: 'TypeScript', sub: 'Backend + SDK' },
            { name: 'React', sub: 'Dashboard' },
            { name: 'Node.js', sub: 'REST API' },
            { name: 'PostgreSQL', sub: 'Event Index' },
          ].map((t) => (
            <div className="lp-stack-pill" key={t.name}>
              <span className="lp-stack-name">{t.name}</span>
              <span className="lp-stack-sub">{t.sub}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta">
        <h2 className="lp-cta-title">Ready to record a commitment?</h2>
        <p className="lp-cta-sub">The contract is live on Stellar Testnet. No wallet required to browse — connect to create or attest.</p>
        <div className="lp-hero-actions">
          <button className="lp-btn-white lp-btn-lg" id="cta-launch-btn" onClick={onLaunchApp}>
            Open Dashboard
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
          <button className="lp-btn-ghost-white lp-btn-lg" onClick={onOpenDocs}>Read the Docs</button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-logo">
          <div className="lp-logo-icon lp-logo-icon-sm">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.2l5 2.8v5.6L10 15.4 5 12.6V7l5-2.8z" />
            </svg>
          </div>
          <span>Pactum</span>
        </div>
        <div className="lp-footer-links">
          <a href="https://github.com/amankoli09/Pactum" target="_blank" rel="noopener noreferrer">GitHub</a>
          <button onClick={onOpenDocs}>Docs</button>
          <a href="https://stellar.expert/explorer/testnet/contract/CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E" target="_blank" rel="noopener noreferrer">Explorer</a>
        </div>
        <div className="lp-footer-copy">MIT License · Built on Stellar Testnet</div>
      </footer>

    </div>
  );
}
