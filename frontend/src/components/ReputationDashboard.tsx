import React, { useState, useEffect } from 'react';

export interface CommitmentItem {
  id: number;
  issuer: string;
  counterparty: string;
  terms_hash: string;
  due_at: number;
  status: 'Fulfilled' | 'Late' | 'Breached' | 'Pending' | 'Disputed';
  created_at: number;
  attested_at: number | null;
}

export interface ReputationDashboardProps {
  initialAddress?: string;
  onNavigateAddress?: (address: string) => void;
  onLaunchCreate?: () => void;
}

// Sample dataset of commitments across addresses
const DEMO_COMMITMENTS: CommitmentItem[] = [
  {
    id: 1,
    issuer: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
    counterparty: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX',
    terms_hash: 'a3f9c1d2e4b5678901234567890abcdef1234567890abcdef1234567890ab',
    due_at: Math.floor(Date.now() / 1000) - 86400 * 5,
    status: 'Fulfilled',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 20,
    attested_at: Math.floor(Date.now() / 1000) - 86400 * 4,
  },
  {
    id: 2,
    issuer: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
    counterparty: 'GCJUKUMADK5PKZF7MCQBBNLRH2AIZQPK5JXBZWBZM7S4CGAJKUMA6V4',
    terms_hash: 'b7e2d1c3f5a6789012345678901abcdef234567890abcdef234567890abc',
    due_at: Math.floor(Date.now() / 1000) - 86400 * 10,
    status: 'Breached',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 30,
    attested_at: Math.floor(Date.now() / 1000) - 86400 * 8,
  },
  {
    id: 3,
    issuer: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX',
    counterparty: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
    terms_hash: 'c8f3e2d4a6b7890123456789012abcdef345678901abcdef345678901abcd',
    due_at: Math.floor(Date.now() / 1000) - 86400 * 2,
    status: 'Fulfilled',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 15,
    attested_at: Math.floor(Date.now() / 1000) - 86400 * 1,
  },
  {
    id: 4,
    issuer: 'GCJUKUMADK5PKZF7MCQBBNLRH2AIZQPK5JXBZWBZM7S4CGAJKUMA6V4',
    counterparty: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX',
    terms_hash: 'd9a4f3e5b7c8901234567890123abcdef456789012abcdef456789012abcde',
    due_at: Math.floor(Date.now() / 1000) + 86400 * 8,
    status: 'Pending',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 2,
    attested_at: null,
  },
  {
    id: 5,
    issuer: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C',
    counterparty: 'GD7H8K9L0M1N2P3Q4R5S6T7U8V9W0X1Y2Z3A4B5C6D7E8F9G0H1I2J3K4L',
    terms_hash: 'e0b5f4e6c8d9012345678901234abcdef56789012abcdef56789012abcdef',
    due_at: Math.floor(Date.now() / 1000) - 86400 * 1,
    status: 'Late',
    created_at: Math.floor(Date.now() / 1000) - 86400 * 12,
    attested_at: Math.floor(Date.now() / 1000),
  }
];

const PRESET_ADDRESSES = [
  { label: 'Issuer Demo (GAJK...)', address: 'GAJKUMA6V4MJKQPFM4MXNMWQZX3CTMK2KMMCSZQPK5JXBZWBZM7S4C' },
  { label: 'Counterparty Demo (GB4U...)', address: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX' },
  { label: 'Empty Address (GNEW...)', address: 'GNEWADDRESSWITHNOCOMMITMENTSHISTORY123456789012345678' }
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
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 3;

  useEffect(() => {
    if (initialAddress && initialAddress !== activeAddress) {
      setSearchQuery(initialAddress);
      setActiveAddress(initialAddress);
    }
  }, [initialAddress]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    triggerAddressChange(searchQuery.trim());
  };

  const triggerAddressChange = (addr: string) => {
    setIsLoading(true);
    setActiveAddress(addr);
    setSearchQuery(addr);
    setCurrentPage(1);
    if (onNavigateAddress) {
      onNavigateAddress(addr);
    }

    // Simulate API query latency
    setTimeout(() => {
      setIsLoading(false);
    }, 450);
  };

  // Filter commitments associated with activeAddress
  const addressCommitments = DEMO_COMMITMENTS.filter(
    (c) => c.issuer === activeAddress || c.counterparty === activeAddress
  );

  // Compute Scorecard Metrics
  const totalCount = addressCommitments.length;
  const fulfilledCount = addressCommitments.filter((c) => c.status === 'Fulfilled').length;
  const lateCount = addressCommitments.filter((c) => c.status === 'Late').length;
  const breachedCount = addressCommitments.filter((c) => c.status === 'Breached').length;
  const pendingCount = addressCommitments.filter((c) => c.status === 'Pending').length;

  const fulfillmentRate = totalCount > 0 ? Math.round((fulfilledCount / totalCount) * 100) : 0;

  // Filter list by status tab
  const filteredCommitments = addressCommitments.filter((c) => {
    if (statusFilter === 'All') return true;
    return c.status === statusFilter;
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredCommitments.length / itemsPerPage) || 1;
  const paginatedCommitments = filteredCommitments.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const shortenAddr = (addr: string) => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 6)}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="reputation-dashboard-container space-y-6">
      {/* ── Search Bar Section ── */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Public Compliance Scorecard
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Search any Stellar address to view its immutable, on-chain commitment record.
            </p>
          </div>

          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
            Stellar Testnet
          </span>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter Stellar Address (G...)"
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono transition-all"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            Lookup Reputation
          </button>
        </form>

        {/* Presets / Quick Links */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quick Presets:</span>
          {PRESET_ADDRESSES.map((preset) => (
            <button
              key={preset.address}
              onClick={() => triggerAddressChange(preset.address)}
              className={`text-xs px-2.5 py-1 rounded-md transition-all font-mono ${
                activeAddress === preset.address
                  ? 'bg-indigo-100 text-indigo-800 font-semibold border border-indigo-300'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Active Address Banner ── */}
      <div className="bg-slate-900 text-white rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Target Account</span>
          <div className="text-sm sm:text-base font-mono font-bold break-all flex items-center gap-2">
            {activeAddress}
            <button
              onClick={() => navigator.clipboard.writeText(activeAddress)}
              className="text-slate-400 hover:text-white transition-colors"
              title="Copy Address"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-800 px-4 py-2 rounded-lg text-right">
            <div className="text-xs text-slate-400">Reliability Rating</div>
            <div className="text-lg font-bold text-emerald-400">{totalCount > 0 ? `${fulfillmentRate}%` : 'N/A'}</div>
          </div>
        </div>
      </div>

      {/* ── Scorecard Component ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm animate-pulse space-y-3">
              <div className="h-4 bg-slate-200 rounded w-1/2"></div>
              <div className="h-8 bg-slate-300 rounded w-1/3"></div>
              <div className="h-3 bg-slate-100 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Commitments Card */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Commitments</span>
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="text-3xl font-extrabold text-slate-900">{totalCount}</div>
            <div className="text-xs text-slate-500 mt-1">Recorded on-chain ({pendingCount} pending)</div>
          </div>

          {/* Fulfilled Card (Green) */}
          <div className="bg-emerald-50/60 p-5 rounded-xl border border-emerald-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between text-emerald-800 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Fulfilled</span>
              <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            </div>
            <div className="text-3xl font-extrabold text-emerald-700">{fulfilledCount}</div>
            <div className="text-xs text-emerald-600 mt-1 font-medium">Met on time</div>
          </div>

          {/* Late Card (Yellow/Amber) */}
          <div className="bg-amber-50/60 p-5 rounded-xl border border-amber-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between text-amber-800 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Late</span>
              <span className="p-1.5 bg-amber-100 text-amber-700 rounded-lg">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
            </div>
            <div className="text-3xl font-extrabold text-amber-700">{lateCount}</div>
            <div className="text-xs text-amber-600 mt-1 font-medium">Attested after due date</div>
          </div>

          {/* Breached Card (Red/Rose) */}
          <div className="bg-rose-50/60 p-5 rounded-xl border border-rose-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between text-rose-800 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Breached</span>
              <span className="p-1.5 bg-rose-100 text-rose-700 rounded-lg">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
            </div>
            <div className="text-3xl font-extrabold text-rose-700">{breachedCount}</div>
            <div className="text-xs text-rose-600 mt-1 font-medium">Failed or unfulfilled</div>
          </div>
        </div>
      )}

      {/* ── Commitments List / Table Section ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Associated Commitments</h3>
            <p className="text-xs text-slate-500">History of agreements as issuer or counterparty</p>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-medium">
            {['All', 'Fulfilled', 'Late', 'Breached', 'Pending'].map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setStatusFilter(tab);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  statusFilter === tab
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Loading Skeleton for Table */}
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-lg"></div>
            ))}
          </div>
        ) : filteredCommitments.length === 0 ? (
          /* Empty State Requirement: "No commitments found for this address" */
          <div className="p-12 text-center space-y-4">
            <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-bold text-slate-800">No commitments found for this address</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                This address currently has no recorded agreements on Pactum Stellar Testnet registry.
              </p>
            </div>
            {onLaunchCreate && (
              <button
                onClick={onLaunchCreate}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
              >
                + Create Commitment for this Address
              </button>
            )}
          </div>
        ) : (
          /* Commitments Table */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4">ID</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Counterparty</th>
                  <th className="py-3.5 px-4">Terms Hash</th>
                  <th className="py-3.5 px-4">Due Date</th>
                  <th className="py-3.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {paginatedCommitments.map((c) => {
                  const isIssuer = c.issuer === activeAddress;
                  const counterpartyAddr = isIssuer ? c.counterparty : c.issuer;

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">#{c.id}</td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                          isIssuer ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}>
                          {isIssuer ? 'Issuer' : 'Counterparty'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600" title={counterpartyAddr}>
                        {shortenAddr(counterpartyAddr)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]" title={c.terms_hash}>
                        {c.terms_hash.substring(0, 14)}...
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 font-sans">{formatDate(c.due_at)}</td>
                      <td className="py-3.5 px-4 font-sans">
                        {c.status === 'Fulfilled' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Fulfilled
                          </span>
                        )}
                        {c.status === 'Late' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            Late
                          </span>
                        )}
                        {c.status === 'Breached' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            Breached
                          </span>
                        )}
                        {c.status === 'Pending' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between font-sans">
              <span className="text-xs text-slate-500">
                Showing Page <span className="font-semibold text-slate-900">{currentPage}</span> of{' '}
                <span className="font-semibold text-slate-900">{totalPages}</span> ({filteredCommitments.length} total)
              </span>

              <div className="flex items-center gap-2">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReputationDashboard;
