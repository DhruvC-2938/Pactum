import React, { useEffect, useRef } from 'react';
import { useWallet } from '../context/WalletContext';
import { Wallet, X, Check, Copy, Shield, Download, Info } from 'lucide-react';

export interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectWalletModal: React.FC<ConnectWalletModalProps> = ({ isOpen, onClose }) => {
  const { address, isConnected, isConnecting, connectWallet, disconnectWallet, availableAdapters, selectedAdapter, clearError } = useWallet();
  const [copied, setCopied] = React.useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleConnectAdapter = async (adapter: WalletConnectAdapter) => {
    await connectWallet(adapter.adapter.id);
  };

  const shorten = (str: string) => {
    if (!str || str.length < 12) return str;
    return `${str.substring(0, 6)}...${str.substring(str.length - 4)}`;
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        zIndex: 1000,
        width: '420px',
        background: '#ffffff',
        border: '1.5px solid #e2e8f0',
        borderRadius: '20px',
        padding: '24px',
        boxShadow: '0 24px 48px -10px rgba(15, 23, 42, 0.16), 0 4px 12px rgba(0,0,0,0.04)',
        textAlign: 'left',
        transformOrigin: 'top right',
        animation: 'slideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Wallet size={13} />
          Wallet Connect
        </div>

        <button
          onClick={onClose}
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            cursor: 'pointer'
          }}
          title="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Connected View */}
      {isConnected && address ? (
        <div>
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '16px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '10.5px', fontWeight: '800', color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: '100px', border: '1px solid #bbf7d0', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e' }}></span>
                Stellar Testnet Live
              </span>
              <button
                onClick={handleCopy}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  color: '#334155',
                  cursor: 'pointer',
                  fontWeight: '700',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {copied ? <Check size={11} color="#16a34a" /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: '13.5px', fontWeight: '800', color: '#0f172a', wordBreak: 'break-all' }}>
              {shorten(address)}
            </div>
          </div>

          <button
            onClick={() => {
              disconnectWallet();
              onClose();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: '#ffffff',
              border: '1px solid #fecdd3',
              color: '#be123c',
              fontSize: '12.5px',
              fontWeight: '700',
              padding: '9px',
              borderRadius: '10px',
              cursor: 'pointer'
            }}
          >
            <LogOut size={13} />
            Disconnect Wallet
          </button>
        </div>
      ) : (
        /* Disconnected State: Adapter Selection */
        <div>
          {/* Available Adapters Section */}
          {availableAdapters.length > 0 ? (
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px',
                fontSize: '11px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em'
              }}>
                Available Wallets
                <span style={{ color: '#10b981', fontWeight: '600' }}>({availableAdapters.filter(a => a.status === 'available').length})</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                {availableAdapters.map((adapter) => (
                  <div
                    key={adapter.adapter.id}
                    style={{
                      border: `1.5px solid ${adapter.status === 'available' ? '#10b981' : '#64748b'}`,
                      borderRadius: '12px',
                      padding: '16px',
                      background: adapter.status === 'available' ? '#f0fdf4' : '#f8fafc',
                      cursor: adapter.status === 'available' ? 'pointer' : 'default',
                      transition: 'all 0.15s ease'
                    }}
                    onClick={() => handleConnectAdapter(adapter)}
                    role="button"
                    tabIndex={adapter.status === 'available' ? 0 : -1}
                    aria-disabled={adapter.status !== 'available'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '8px',
                        background: adapter.status === 'available' ? 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)' : '#e2e8f0',
                        color: '#ffffff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16
                      }}>
                        <Wallet size={20} />
                      </div>
                      <div>
                        <div style={{ fontWeight: '600', color: '#0f172a' }}>{adapter.adapter.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{adapter.adapter.description}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: adapter.status === 'available' ? '#059669' : '#64748b' }}>
                      {adapter.status === 'available' ? 'Available' : 'Unavailable'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', marginBottom: '24px', color: '#64748b' }}>
              <Info size={24} style={{ color: '#94a3b8', marginBottom: '8px' }} />
              <p>No wallets detected. Please install a supported wallet extension.</p>
              <a
                href="https://freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginTop: '12px',
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  background: '#0f172a', color: '#ffffff', fontWeight: '700', fontSize: '12px',
                  padding: '8px 16px', borderRadius: '12px', textDecoration: 'none'
                }}
              >
                <Download size={16} /> Install Freighter
              </a>
            </div>
          )}

          {/* Connection Status */}
          {selectedAdapter && selectedAdapter.status === 'connecting' ? (
            <div style={{ textAlign: 'center', margin: '20px 0', padding: '20px', background: '#f8fafc', borderRadius: '12px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>Connecting with {selectedAdapter.adapter.name}...</div>
              <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderRadius: '50%', margin: '0 auto', borderLeftColor: '#3b82f6', borderLeftWidth: '3px', animation: 'spin 1s linear infinite' }}></div>
            </div>
          ) : selectedAdapter ? (
            <div style={{ textAlign: 'center', margin: '20px 0', padding: '20px', background: '#f8fafc', borderRadius: '12px' }}>
              <Shield size={24} style={{ color: '#f87171', marginBottom: '8px' }} />
              <p style={{ fontSize: '12px', color: '#64748b' }}>Unable to connect with {selectedAdapter.adapter.name}</p>
              <button
                onClick={() => { setSelectedAdapter(null); }}
                style={{
                  marginTop: '8px', background: 'transparent', border: 'none', color: '#3b82f6',
                  fontWeight: '600', fontSize: '11px', cursor: 'pointer'
                }}
              >
                Try Different Wallet
              </button>
            </div>
          ) : (
            /* No adapters message */
            <div style={{ textAlign: 'center', margin: '20px 0' }}>
              <Shield size={24} style={{ color: '#94a3b8' }} />
              <p style={{ fontSize: '12px', color: '#64748b' }}>No wallets available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ConnectWalletModal;