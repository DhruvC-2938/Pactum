import React, { useState, useEffect, useRef } from 'react';
import UserProfile from './UserProfile';
import { fetchCommitments, fetchReputation, Commitment, Reputation } from '../lib/api';

export interface ReputationDashboardProps {
  initialAddress?: string;
  onNavigateAddress?: (address: string) => void;
  onLaunchCreate?: () => void;
}

const PRESETS = [
  { label: 'Issuer Demo (GAJK...)', address: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C' },
  { label: 'Counterparty (GB4U...)', address: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX' },
  { label: 'Empty Account (GNEW...)', address: 'GNEWADDRESSWITHNOCOMMITMENTSHISTORY123456789012345678' }
];

export const ReputationDashboard: React.FC<ReputationDashboardProps> = ({
  initialAddress = 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
  onNavigateAddress,
  onLaunchCreate
}) => {
  const [searchQuery, setSearchQuery] = useState(initialAddress);
  const [activeAddress, setActiveAddress] = useState(initialAddress);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  // Pagination & Data State
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const itemsPerPage = 50;

  useEffect(() => {
    if (initialAddress && initialAddress !== activeAddress) {
      setSearchQuery(initialAddress);
      setActiveAddress(initialAddress);
    }
  }, [initialAddress, activeAddress]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    triggerAddressChange(searchQuery.trim());
  };

  const triggerAddressChange = (addr: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setActiveAddress(addr);
    setSearchQuery(addr);
    setReputation(null);
    setCommitments([]);
    setPage(1);
    setHasMore(true);
    if (onNavigateAddress) {
      onNavigateAddress(addr);
    }
  };

  const loadCommitments = React.useCallback(async (pageNum: number, isAppend = false, signal?: AbortSignal) => {
    const filters: any = {
      address: activeAddress,
      status: statusFilter === 'All' ? undefined : statusFilter,
      page: pageNum,
      limit: itemsPerPage
    };
    const data = await fetchCommitments(filters, signal);

    if (signal?.aborted) return;
    setCommitments(prev => isAppend ? [...prev, ...data] : data);
    setHasMore(data.length === itemsPerPage);
    return data;
  }, [activeAddress, statusFilter]);

  const loadMore = React.useCallback(async () => {
    if (isFetchingRef.current || !hasMore) return;

    isFetchingRef.current = true;
    setIsFetchingMore(true);
    setFetchError(null);

    try {
      const nextPage = page + 1;
      await loadCommitments(nextPage, true, abortRef.current?.signal);
      setPage(nextPage);
    } catch (error) {
      setFetchError('Failed to load more commitments. Please try again.');
      console.error('Load more error:', error);
    } finally {
      setIsFetchingMore(false);
      isFetchingRef.current = false;
    }
  }, [page, hasMore, loadCommitments]);

  useEffect(() => {
    const signal = abortRef.current?.signal;

    const initializeData = async () => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const [repData] = await Promise.all([
          fetchReputation(activeAddress, signal),
          loadCommitments(1, false, signal)
        ]);

        if (!signal?.aborted) {
          setReputation(repData);
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Initialization error:', error);
          setFetchError('Failed to initialize dashboard data.');
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    };

    initializeData();

    return () => abortRef.current?.abort();
  }, [activeAddress, statusFilter, loadCommitments]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 1.0 }
    );

    if (bottomRef.current) {
      observer.observe(bottomRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isFetchingMore, loadMore]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const totalCount = reputation?.total ?? 0;
  const fulfilledCount = reputation?.fulfilled ?? 0;
  const lateCount = reputation?.late ?? 0;
  const breachedCount = reputation?.breached ?? 0;
  const calculatedPending = reputation ? (reputation.total - (reputation.fulfilled + reputation.late + reputation.breached)) : 0;
  const fulfillmentRate = totalCount > 0 ? Math.round((fulfilledCount / totalCount) * 100) : 0;

  const strokeDashoffset = 226 - (226 * fulfillmentRate) / 100;

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', color: '#1e293b' }}>
      {/* ── Search Bar Section ── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '20px',
        padding: '20px 24px',
        marginBottom: '24px',
        boxShadow: '0 4px 20px -2px rgba(0,0,0,0.05)'
      }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            background: '#f8fafc',
            border: '1.5px solid #cbd5e1',
            borderRadius: '12px',
            padding: '10px 16px',
            transition: 'border-color 0.2s ease'
          }}>
            <svg width="18" height="18" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" style={{ marginRight: '12px', flexShrink: 0 }}>
              <circle cx="8" cy="8" r="6" />
              <path d="M16 16l-3.5-3.5" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Stellar account address (G...)"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#0f172a',
                fontFamily: 'monospace',
                fontSize: '13.5px',
                fontWeight: '600'
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              background: '#0f172a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 24px',
              fontSize: '13.5px',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(15,23,42,0.15)',
              transition: 'transform 0.15s ease, background 0.15s ease',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            Lookup Account
          </button>
        </form>

        {/* Quick Preset Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick Presets:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.address}
              onClick={() => triggerAddressChange(preset.address)}
              style={{
                fontSize: '12px',
                fontFamily: 'monospace',
                padding: '6px 14px',
                borderRadius: '100px',
                border: activeAddress === preset.address ? '1.5px solid #6366f1' : '1px solid #e2e8f0',
                background: activeAddress === preset.address ? '#e0e7ff' : '#f8fafc',
                color: activeAddress === preset.address ? '#3730a3' : '#475569',
                fontWeight: activeAddress === preset.address ? '700' : '500',
                cursor: 'pointer',
                transition: 'all 0.16s ease',
                boxShadow: activeAddress === preset.address ? '0 2px 8px rgba(99,102,241,0.18)' : 'none'
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Light Pastel Hero Identity Card ── */}
      <div style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        border: '1px solid #e2e8f0',
        borderRadius: '24px',
        padding: '26px 32px',
        marginBottom: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '24px',
        boxShadow: '0 10px 30px -5px rgba(0,0,0,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6366f1' }}>
                Stellar Account Record
              </span>
              <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', fontWeight: '700', padding: '3px 10px', borderRadius: '100px', border: '1px solid #bbf7d0', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></span>
                Stellar Testnet Live
              </span>
            </div>

            <UserProfile address={activeAddress} avatarSize={44} showDomain={true} />
          </div>
        </div>

        {/* Circular Reliability Gauge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', background: '#ffffff', padding: '14px 22px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reliability Score</div>
            <div style={{ fontSize: '26px', fontWeight: '900', color: fulfillmentRate >= 70 ? '#16a34a' : fulfillmentRate >= 40 ? '#d97706' : '#dc2626' }}>
              {totalCount > 0 ? `${fulfillmentRate}%` : 'N/A'}
            </div>
          </div>

          <div style={{ position: 'relative', width: '52px', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="52" height="52" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="36" stroke="#f1f5f9" strokeWidth="8" fill="none" />
              <circle
                cx="40"
                cy="40"
                r="36"
                stroke={fulfillmentRate >= 70 ? '#22c55e' : fulfillmentRate >= 40 ? '#f59e0b' : '#ef4444'}
                strokeWidth="8"
                fill="none"
                strokeDasharray="226"
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 40 40)"
                style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
              />
            </svg>
            <span style={{ position: 'absolute', fontSize: '12px', fontWeight: '900', color: '#0f172a' }}>
              {totalCount > 0 ? `${fulfillmentRate}` : '0'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Soft Pastel Scorecards Grid ── */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px', marginBottom: '24px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '18px', padding: '24px', height: '110px', animation: 'pulse 1.5s infinite' }}>
              <div style={{ width: '45%', height: '12px', background: '#f1f5f9', borderRadius: '4px', marginBottom: '14px' }}></div>
              <div style={{ width: '30%', height: '28px', background: '#e2e8f0', borderRadius: '6px' }}></div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px', marginBottom: '24px' }}>

          {/* Total Commitments Card (Soft Lavender) */}
          <div
            onMouseEnter={() => setHoveredCard('total')}
            onMouseLeave={() => setHoveredCard(null)}
            style={{
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: hoveredCard === 'total' ? '0 12px 28px -6px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.03)',
              transform: hoveredCard === 'total' ? 'translateY(-3px)' : 'translateY(0)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Total Commitments
            </div>
            <div style={{ fontSize: '38px', fontWeight: '900', color: '#0f172a', lineHeight: '1' }}>{totalCount}</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '10px', fontWeight: '500' }}>On-chain record ({calculatedPending} pending)</div>
          </div>

          {/* Fulfilled Card (Pastel Mint) */}
          <div
            onMouseEnter={() => setHoveredCard('fulfilled')}
            onMouseLeave={() => setHoveredCard(null)}
            style={{
              background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
              border: '1.5px solid #bbf7d0',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: hoveredCard === 'fulfilled' ? '0 12px 28px -6px rgba(34,197,94,0.18)' : '0 2px 8px rgba(34,197,94,0.04)',
              transform: hoveredCard === 'fulfilled' ? 'translateY(-3px)' : 'translateY(0)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: '800', color: '#166534', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fulfilled</span>
              <span style={{ fontSize: '11px', fontWeight: '800', padding: '3px 10px', borderRadius: '100px', background: '#ffffff', color: '#15803d', border: '1px solid #bbf7d0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                ✓ On Time
              </span>
            </div>
            <div style={{ fontSize: '38px', fontWeight: '900', color: '#15803d', lineHeight: '1' }}>{fulfilledCount}</div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#166534', marginTop: '10px' }}>Met on time</div>
          </div>

          {/* Late Card (Pastel Honey) */}
          <div
            onMouseEnter={() => setHoveredCard('late')}
            onMouseLeave={() => setHoveredCard(null)}
            style={{
              background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
              border: '1.5px solid #fde68a',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: hoveredCard === 'late' ? '0 12px 28px -6px rgba(245,158,11,0.18)' : '0 2px 8px rgba(245,158,11,0.04)',
              transform: hoveredCard === 'late' ? 'translateY(-3px)' : 'translateY(0)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: '800', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Late</span>
              <span style={{ fontSize: '11px', fontWeight: '800', padding: '3px 10px', borderRadius: '100px', background: '#ffffff', color: '#b45309', border: '1px solid #fde68a', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                ⏰ Delayed
              </span>
            </div>
            <div style={{ fontSize: '38px', fontWeight: '900', color: '#b45309', lineHeight: '1' }}>{lateCount}</div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#92400e', marginTop: '10px' }}>Attested after due date</div>
          </div>

          {/* Breached Card (Pastel Coral) */}
          <div
            onMouseEnter={() => setHoveredCard('breached')}
            onMouseLeave={() => setHoveredCard(null)}
            style={{
              background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
              border: '1.5px solid #fecdd3',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: hoveredCard === 'breached' ? '0 12px 28px -6px rgba(239,68,68,0.18)' : '0 2px 8px rgba(239,68,68,0.04)',
              transform: hoveredCard === 'breached' ? 'translateY(-3px)' : 'translateY(0)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: '800', color: '#9f1239', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Breached</span>
              <span style={{ fontSize: '11px', fontWeight: '800', padding: '3px 10px', borderRadius: '100px', background: '#ffffff', color: '#be123c', border: '1px solid #fecdd3', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                ✕ Breached
              </span>
            </div>
            <div style={{ fontSize: '38px', fontWeight: '900', color: '#be123c', lineHeight: '1' }}>{breachedCount}</div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#9f1239', marginTop: '10px' }}>Failed or unfulfilled</div>
          </div>
        </div>
      )}

      {/* ── Associated Commitments Table ── */}
      <div style={{
        background: '#ffffff',
        border: '1.5px solid #e2e8f0',
        borderRadius: '24px',
        overflow: 'hidden',
        boxShadow: '0 4px 20px -2px rgba(0,0,0,0.04)'
      }}>
        {fetchError && (
          <div style={{ background: '#fef2f2', color: '#dc2626', padding: '12px 24px', fontSize: '13px', fontWeight: '500', borderBottom: '1px solid #fee2e2', textAlign: 'center' }}>
            {fetchError}
          </div>
        )}
        <div style={{ padding: '22px 28px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: 0 }}>Associated Commitments</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '3px 0 0 0' }}>Activity history as issuer or counterparty</p>
          </div>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            {['All', 'Fulfilled', 'Late', 'Breached', 'Pending'].map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setStatusFilter(tab);
                  setPage(1);
                }}
                style={{
                  fontSize: '12px',
                  fontWeight: statusFilter === tab ? '800' : '500',
                  padding: '6px 14px',
                  borderRadius: '7px',
                  border: 'none',
                  background: statusFilter === tab ? '#ffffff' : 'transparent',
                  color: statusFilter === tab ? '#0f172a' : '#64748b',
                  boxShadow: statusFilter === tab ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Empty State Requirement: "No commitments found for this address" */}
        {commitments.length === 0 && !isLoading ? (
          <div style={{ padding: '72px 24px', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', background: '#f8fafc', color: '#94a3b8', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px auto', fontSize: '28px', border: '1px solid #e2e8f0' }}>
              📭
            </div>
            <h4 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 6px 0' }}>
              No commitments found for this address
            </h4>
            <p style={{ fontSize: '13.5px', color: '#64748b', maxWidth: '400px', margin: '0 auto 22px auto' }}>
              This account currently has no registered commitment activity on Pactum Stellar Testnet.
            </p>
            {onLaunchCreate && (
              <button
                onClick={onLaunchCreate}
                style={{
                  padding: '10px 22px',
                  background: '#0f172a',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: '700',
                  borderRadius: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(15,23,42,0.15)'
                }}
              >
                + Create Commitment for this Address
              </button>
            )}
          </div>
        ) : (
          <div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontWeight: '800', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ padding: '16px 24px' }}>ID</th>
                    <th style={{ padding: '16px 24px' }}>Role</th>
                    <th style={{ padding: '16px 24px' }}>Counterparty</th>
                    <th style={{ padding: '16px 24px' }}>Terms Hash</th>
                    <th style={{ padding: '16px 24px' }}>Due Date</th>
                    <th style={{ padding: '16px 24px' }}>Status</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: 'monospace' }}>
                  {commitments.map((c) => {
                    const isIssuer = c.issuer === activeAddress;
                    const counterpartyAddr = isIssuer ? c.counterparty : c.issuer;

                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}>
                        <td style={{ padding: '18px 24px', fontWeight: '800', color: '#0f172a' }}>#{c.id}</td>
                        <td style={{ padding: '18px 24px' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '800',
                            background: isIssuer ? '#e0e7ff' : '#f1f5f9',
                            color: isIssuer ? '#3730a3' : '#475569',
                            border: isIssuer ? '1px solid #c7d2fe' : '1px solid #e2e8f0'
                          }}>
                            {isIssuer ? 'Issuer' : 'Counterparty'}
                          </span>
                        </td>
                        <td style={{ padding: '18px 24px' }}>
                          <UserProfile address={counterpartyAddr} avatarSize={24} showDomain={false} />
                        </td>
                        <td style={{ padding: '18px 24px', color: '#64748b', fontSize: '12px' }} title={c.terms_hash}>
                          {c.terms_hash.substring(0, 14)}...
                        </td>
                        <td style={{ padding: '18px 24px', color: '#0f172a', fontFamily: 'sans-serif', fontWeight: '600' }}>
                          {formatDate(c.due_at)}
                        </td>
                        <td style={{ padding: '18px 24px', fontFamily: 'sans-serif' }}>
                          {c.status === 'Fulfilled' && (
                            <span style={{ padding: '4px 12px', borderRadius: '100px', fontSize: '12px', fontWeight: '800', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></span>
                              Fulfilled
                            </span>
                          )}
                          {c.status === 'Late' && (
                            <span style={{ padding: '4px 12px', borderRadius: '100px', fontSize: '12px', fontWeight: '800', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }}></span>
                              Late
                            </span>
                          )}
                          {c.status === 'Breached' && (
                            <span style={{ padding: '4px 12px', borderRadius: '100px', fontSize: '12px', fontWeight: '800', background: '#ffe4e6', color: '#be123c', border: '1px solid #fecdd3', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }}></span>
                              Breached
                            </span>
                          )}
                          {c.status === 'Pending' && (
                            <span style={{ padding: '4px 12px', borderRadius: '100px', fontSize: '12px', fontWeight: '800', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94a3b8' }}></span>
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div ref={bottomRef} style={{ height: '20px' }}>
              {isFetchingMore && (
                <div style={{ textAlign: 'center', padding: '16px', fontSize: '13px', color: '#64748b', fontWeight: '500' }}>
                  Loading more commitments...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReputationDashboard;
