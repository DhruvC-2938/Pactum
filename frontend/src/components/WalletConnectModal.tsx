import React, { useEffect, useRef } from 'react';
import { useWallet } from '../context/WalletContext';
import { Wallet, X, Check, Copy, Shield, LogOut } from 'lucide-react';

export interface WalletConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({ isOpen, onClose }) => {
  const { address, isConnected, isConnecting, connectWallet, disconnectWallet } = useWallet();
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
      // Delay listener slightly to prevent immediate close on button click
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 50);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleConnectFreighter = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await connectWallet();
  };

  const shorten = (str: string) => {
    if (!str || str.length < 12) return str;
    return `${str.substring(0, 6)}...${str.substring(str.length - 4)}`;
  };

  return (
    <div
      ref={dropdownRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        zIndex: 1000,
        width: '360px',
        background: '#ffffff',
        border: '1.5px solid #e2e8f0',
        borderRadius: '18px',
        padding: '20px',
        boxShadow: '0 16px 36px -6px rgba(15, 23, 42, 0.16), 0 4px 12px rgba(0,0,0,0.04)',
        textAlign: 'left',
        transformOrigin: 'top right',
        animation: 'slideDown 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Wallet size={13} />
          Stellar Wallet
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '50%',
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            cursor: 'pointer'
          }}
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Connected View */}
      {isConnected && address ? (
        <div>
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '14px',
            marginBottom: '14px'
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
            onClick={(e) => {
              e.stopPropagation();
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
        /* Disconnected State: Dropping Banner Option */
        <div>
          <button
            onClick={handleConnectFreighter}
            disabled={isConnecting}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: '#ffffff',
              border: '1.5px solid #6366f1',
              borderRadius: '14px',
              cursor: isConnecting ? 'wait' : 'pointer',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.08)',
              transition: 'all 0.15s ease',
              textAlign: 'left'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Wallet size={18} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>
                  Freighter Wallet
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '1px' }}>
                  Official Stellar Extension
                </div>
              </div>
            </div>

            <span style={{ fontSize: '12.5px', fontWeight: '800', color: '#6366f1' }}>
              {isConnecting ? 'Connecting...' : 'Connect →'}
            </span>
          </button>

          <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Shield size={11} />
            100% Non-Custodial Browser Security
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletConnectModal;
