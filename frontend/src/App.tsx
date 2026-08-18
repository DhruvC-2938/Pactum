import { useState, useEffect } from 'react'

import './App.css'
import LandingPage from './components/LandingPage'
import DocsPage from './components/DocsPage'
import CreateCommitmentWizard from './components/CreateCommitmentWizard'
import ReputationDashboard from './components/ReputationDashboard'
import { useWallet } from './context/WalletContext'
import { Wallet, CheckCircle2, LogOut } from 'lucide-react'
import { useCommitments } from './hooks/useCommitments'
import type { Commitment, CommitmentStatus } from './lib/api'
import { WalletButton } from './components/WalletButton'

function renderCommitmentItem(commitment: Commitment) {
  return (
    <div className="commitment-item" key={commitment.id}>
      <div className="commitment-avatar" style={{ background: '#e8e4f3', color: '#5b4d8a' }}>
        {commitment.issuer.charAt(0)}
      </div>
      <div className="commitment-info">
        <div className="commitment-id">Commitment #{commitment.id}</div>
        <div className="commitment-parties">
          {commitment.issuer} &rarr; {commitment.counterparty}
        </div>
        <div className="commitment-due">{new Date(commitment.due_at * 1000).toLocaleDateString()}</div>
      </div>
      <div className="commitment-status">
        <span className={`badge ${commitment.status.toLowerCase()}`}>
          <span className="badge-dot"></span>
          {commitment.status}
        </span>
      </div>
    </div>
  )
}

function WalletButton() {
  const { address, isConnected, isConnecting } = useWallet()
  const [isOpen, setIsOpen] = useState(false)

  const shortenKey = (key: string) => {
    if (!key || key.length < 10) return key
    return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {isConnected && address ? (
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className="btn btn-secondary btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#f0fdf4',
            borderColor: '#bbf7d0',
            color: '#15803d',
            fontWeight: '700',
            fontFamily: 'monospace'
          }}
          title="Click to view wallet details"
        >
          <CheckCircle2 size={13} color="#22c55e" />
          {shortenKey(address)}
        </button>
      ) : (
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          disabled={isConnecting}
          className="btn btn-secondary btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: '700',
            borderColor: '#cbd5e1'
          }}
        >
          <Wallet size={14} />
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}

      {/* Dropping Banner Popover Dropdown */}
      <WalletConnectModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  )
}

function InlineWalletError() {
  const { error, clearError } = useWallet()
  return <FreighterInstallModal error={error} onDismiss={clearError} />
}

export default function App() {

  const [activePage, setActivePage] = useState('landing')
  const [commitmentStatus, setCommitmentStatus] = useState<CommitmentStatus>()

  const commitmentsQuery = useCommitments(commitmentStatus ? { status: commitmentStatus } : {})

  const [reputationAddress, setReputationAddress] = useState('GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C')

  useEffect(() => {
    const handleUrlChange = () => {
      const path = window.location.pathname
      if (path.startsWith('/reputation/')) {
        const addr = path.replace('/reputation/', '').trim()
        if (addr) {
          setReputationAddress(addr)
          setActivePage('reputation')
        }
      }
    }

    handleUrlChange()
    window.addEventListener('popstate', handleUrlChange)
    return () => window.removeEventListener('popstate', handleUrlChange)
  }, [])

  const navigateToReputation = (addr: string) => {
    setReputationAddress(addr)
    setActivePage('reputation')
    window.history.pushState({}, '', `/reputation/${addr}`)
  }
  if (activePage === 'landing') {
    return <LandingPage onLaunchApp={() => setActivePage('dashboard')} onOpenDocs={() => setActivePage('docs')} />
  }

  if (activePage === 'docs') {
    return <DocsPage onBack={() => setActivePage('landing')} onLaunchApp={() => setActivePage('dashboard')} />
  }

  return (
    <>
      <div className="app-shell">

  {/* ── Sidebar ── */}
  <aside className="sidebar">
    <div className="sidebar-logo" onClick={() => setActivePage('landing')} style={{ cursor: 'pointer' }} title="Go to Home Page">
      <div className="logo-mark">
        <div className="logo-icon">
          <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.2l5 2.8v5.6L10 15.4 5 12.6V7l5-2.8z"/>
          </svg>
        </div>
        <span className="logo-name">Pactum</span>
      </div>
      <div className="logo-tagline">Commitment Registry · Stellar Testnet</div>
    </div>

    <nav className="sidebar-nav">
      <span className="nav-section-label">Overview</span>

      <button className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`} id="nav-dashboard" onClick={() => setActivePage('dashboard')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="6" height="6" rx="1.5"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5"/>
          </svg>
        </span>
        Dashboard
      </button>

      <button className={`nav-item ${activePage === 'commitments' ? 'active' : ''}`} id="nav-commitments" onClick={() => setActivePage('commitments')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 4h12M2 8h12M2 12h8"/>
          </svg>
        </span>
        Commitments
        <span className="nav-badge" id="badge-commitments">4</span>
      </button>

      <span className="nav-section-label">Actions</span>

      <button className={`nav-item ${activePage === 'create' ? 'active' : ''}`} id="nav-create" onClick={() => setActivePage('create')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M8 2v12M2 8h12"/>
          </svg>
        </span>
        Create Commitment
      </button>

      <button className={`nav-item ${activePage === 'attest' ? 'active' : ''}`} id="nav-attest" onClick={() => setActivePage('attest')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2.5 8.5l3.5 3.5 7.5-7.5"/>
          </span>
          Attest
        </button>

      <button className={`nav-item ${activePage === 'dispute' ? 'active' : ''}`} id="nav-dispute" onClick={() => setActivePage('dispute')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M8 2L1 14h14L8 2z"/>
            <path d="M8 6v4M8 11.5v.5"/>
          </svg>
        </span>
        Raise Dispute
      </button>

      <button className={`nav-item ${activePage === 'resolve' ? 'active' : ''}`} id="nav-resolve" onClick={() => setActivePage('resolve')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="8" cy="8" r="6"/>
            <path d="M5 8l2 2 4-4"/>
          </svg>
        </span>
        Resolve Dispute
      </button>

      <span className="nav-section-label">Lookup</span>

      <button className={`nav-item ${activePage === 'reputation' ? 'active' : ''}`} id="nav-reputation" onClick={() => setActivePage('reputation')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="8" cy="5" r="3"/>
            <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
          </svg>
          Reputation Lookup
        </button>

      <button className={`nav-item ${activePage === 'lookup' ? 'active' : ''}`} id="nav-lookup" onClick={() => setActivePage('lookup')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="6.5" cy="6.5" r="4.5"/>
            <path d="M14 14l-3-3"/>
          </svg>
        </span>
        Get Commitment
      </button>

      <span className="nav-section-label">System</span>

      <button className={`nav-item ${activePage === 'initialize' ? 'active' : ''}`} id="nav-initialize" onClick={() => setActivePage('initialize')}>
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="8" cy="8" r="2.5"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.54 11.54l1.41 1.41M3.05 12.95l1.42-1.42M11.54 4.46l1.41-1.41"/>
          </svg>
        </span>
        Initialize
      </button>
    </nav>

    <div className="sidebar-footer">
      <button
        className="nav-item"
        style={{ width: '100%', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}
        onClick={() => setActivePage('landing')}
      >
        <span className="nav-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 6.5L8 1l7 5.5V14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6.5z" />
          </svg>
        </span>
        Home
      </button>
      <div className="sidebar-network">
        <span className="network-dot"></span>
        <span className="network-name">Stellar Testnet</span>
        <span className="network-sub">Live</span>
      </div>
    </div>
  </aside>


  {/* ── Main Content ── */}
  <main className="main-content">

    {/* Topbar */}
    <header className="topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button
          onClick={() => setActivePage('landing')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '6px 12px',
            fontSize: '12.5px',
            fontWeight: '700',
            color: '#475569',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.15s ease'
          }}
          title="Back to Landing Page"
        >
          ← Home
        </button>

        <span className="topbar-title" id="topbar-title" style={{ margin: 0 }}>
          {activePage === 'reputation' ? 'Reputation Lookup' :
           activePage === 'commitments' ? 'Commitments' :
           activePage === 'create' ? 'Create Commitment' :
           activePage === 'attest' ? 'Attest' :
           activePage === 'dispute' ? 'Raise Dispute' :
           activePage === 'resolve' ? 'Resolve Dispute' :
           activePage === 'lookup' ? 'Get Commitment' :
           activePage === 'initialize' ? 'Initialize' : 'Dashboard'}
        </span>
      </div>

      <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div className="search-bar">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="4.5"/>
            <path d="M14 14l-3-3"/>
          </svg>
          <input type="text" placeholder="Search commitments..." id="global-search" />
        </div>

        {/* Topbar Wallet Connect Component */}
        <WalletButton />

        <button className="btn btn-primary btn-sm" onClick={() => setActivePage('create')}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 2v12M2 8h12"/>
          </svg>
          <span className="btn-text">New</span>
        </button>
      </div>
    </header>

    {/* Inline On-Screen Wallet Error / Installation Alert Banner */}
    <InlineWalletError />

    {/* Toast Container */}
    <div className="toast-container" id="toast-container"></div>

    {/* ──────────────────────────────────────────────
         PAGE: Dashboard
         ────────────────────────────────────────────── */}
    <section className={`page ${activePage === 'dashboard' ? 'active' : ''}`} id="page-dashboard">
      <div className="section-header">
        <div>
          <div className="section-title">Overview</div>
          <div className="section-sub">Your commitment registry at a glance</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => {}}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.7 6A6 6 0 1 0 12 12"/>
            <path d="M14 2v4h-4"/>
          </svg>
          Refresh
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Commitments</div>
          <div className="stat-value" id="stat-total">4</div>
          <div className="stat-change">On Stellar Testnet</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Fulfilled</div>
          <div className="stat-value green" id="stat-fulfilled">2</div>
          <div className="stat-change">Kept on time</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value" id="stat-pending" style={{color: "var(--gray)"}}>1</div>
          <div className="stat-change">Awaiting attestation</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Breached</div>
          <div className="stat-value red" id="stat-breached">1</div>
          <div className="stat-change">Not fulfilled</div>
        </div>
      </div>

      <div className="two-col">
        {/* Recent Commitments */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Commitments</div>
            <button className="btn btn-ghost btn-sm" onClick={() => {}}>View All</button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
              <div className="commitment-list h-[340px] overflow-auto" style={{ padding: '16px' }}>
                <div className="commitment-item">
                  <div className="commitment-avatar" style={{background: '#e8e4f3', color: '#5b4d8a'}}>G</div>
                  <div className="commitment-info">
                    <div className="commitment-id">Commitment #4</div>
                    <div className="commitment-parties">GCJUKU...A6V4 &rarr; GB4UFB...HHZX</div>
                    <div className="commitment-due">Due in 8d</div>
                  </div>
                  <div className="commitment-status">
                    <span className="badge pending"><span className="badge-dot"></span>Pending</span>
                  </div>
                </div>

                <div className="commitment-item">
                  <div className="commitment-avatar" style={{background: '#dde8f5', color: '#3060a0'}}>G</div>
                  <div className="commitment-info">
                    <div className="commitment-id">Commitment #3</div>
                    <div className="commitment-parties">GB4UFB...HHZX &rarr; GAJKUM...7S4C</div>
                    <div className="commitment-due">Due 2d ago</div>
                  </div>
                  <div className="commitment-status">
                    <span className="badge fulfilled"><span className="badge-dot"></span>Fulfilled</span>
                  </div>
                </div>

                <div className="commitment-item">
                  <div className="commitment-avatar" style={{background: '#fae8dc', color: '#a0522d'}}>G</div>
                  <div className="commitment-info">
                    <div className="commitment-id">Commitment #2</div>
                    <div className="commitment-parties">GAJKUM...7S4C &rarr; GCJUKU...A6V4</div>
                    <div className="commitment-due">Due Jul 26</div>
                  </div>
                  <div className="commitment-status">
                    <span className="badge breached"><span className="badge-dot"></span>Breached</span>
                  </div>
                </div>
              </div>
          </div>
        </div>

        {/* Side Panel */}
        <div style={{display: "flex", flexDirection: "column", gap: "14px"}}>
          {/* Contract Info */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Contract</div>
              <span className="badge fulfilled">
                <span className="badge-dot"></span>
                Deployed
              </span>
            </div>
            <div className="card-body" style={{paddingTop: "14px"}}>
              <div className="detail-panel">
                <div className="detail-row">
                  <span className="detail-key">Network</span>
                  <span className="detail-val">Stellar Testnet</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Contract ID</span>
                  <span className="detail-val mono" style={{fontSize: "11px", wordBreak: "break-all"}}>CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Dispute Window</span>
                  <span className="detail-val">7 days</span>
                </div>
              </div>
              <a href="https://stellar.expert/explorer/testnet/contract/CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E"
                 target="_blank" rel="noopener" className="btn btn-secondary btn-sm btn-full" style={{marginTop: "12px"}}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-4"/>
                  <path d="M14 2H9m5 0v5M8 8l6-6"/>
                </svg>
                View on Stellar Expert
              </a>
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Recent Activity</div>
            </div>
            <div className="card-body" style={{paddingTop: "14px"}}>
              <div className="timeline">
                <div className="timeline-item">
                  <div className="timeline-dot-wrap">
                    <div className="timeline-dot" style={{background: "var(--green)", boxShadow: "0 0 0 2px rgba(52,199,89,0.2)"}}></div>
                    <div className="timeline-line"></div>
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-label">Commitment #3 Attested</div>
                    <div className="timeline-date">Marked as Fulfilled</div>
                  </div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-dot-wrap">
                    <div className="timeline-dot" style={{background: "var(--accent)", boxShadow: "0 0 0 2px rgba(0,113,227,0.2)"}}></div>
                    <div className="timeline-line"></div>
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-label">Commitment #4 Created</div>
                    <div className="timeline-date">New pending commitment</div>
                  </div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-dot-wrap">
                    <div className="timeline-dot" style={{background: "var(--red)", boxShadow: "0 0 0 2px rgba(255,59,48,0.2)"}}></div>
                    <div className="timeline-line"></div>
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-label">Commitment #2 Breached</div>
                    <div className="timeline-date">Attested as Breached</div>
                  </div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-dot-wrap">
                    <div className="timeline-dot"></div>
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-label">Contract Initialized</div>
                    <div className="timeline-date">Arbitrator set</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main></div>
        </>
      )
    }