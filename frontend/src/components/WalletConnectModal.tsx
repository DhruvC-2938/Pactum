import React from 'react';
import { useWallet } from '../context/WalletContext';
import { Wallet, X, Check, Copy, Shield, LogOut } from 'lucide-react';

export interface WalletConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({ isOpen, onClose }) => {
  const { address, isConnected, isConnecting, connectWallet, disconnectWallet } = useWallet();
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleConnectFreighter = async () => {
    await connectWallet();
  };

  const shorten = (str: string) => {
    if (!str || str.length < 12) return str;
    return `${str.substring(0, 8)}...${str.substring(str.length - 8)}`;
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      background: 'rgba(15, 23, 42, 0.45)',
      backdropFilter: 'blur(6px)',
      animation: 'fadeIn 0.15s ease-out'
    }}>
      {/* ── Clean White Glass Container ── */}
      <div style={{
        position: 'relative',
        maxWidth: '420px',
        width: '100%',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '20px',
        padding: '28px',
        boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.12)'
      }}>

        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ textAlign: 'left', marginBottom: '22px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
            <Wallet size={13} />
            Stellar Soroban Wallet
          </div>
          <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            {isConnected ? 'Wallet Connected' : 'Connect Wallet'}
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
            {isConnected ? 'Your account is authorized on Pactum Protocol' : 'Connect with Freighter browser wallet'}
          </p>
        </div>

        {/* Connected State View */}
        {isConnected && address ? (
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#16a34a', background: '#dcfce7', padding: '3px 10px', borderRadius: '100px', border: '1px solid #bbf7d0', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></span>
                Stellar Testnet Connected
              </span>
              <button
                onClick={handleCopy}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '11.5px',
                  color: '#475569',
                  cursor: 'pointer',
                  fontWeight: '600',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}
              >
                {copied ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: '800', color: '#0f172a', wordBreak: 'break-all' }}>
              {shorten(address)}
            </div>

            <button
              onClick={() => {
                disconnectWallet();
                onClose();
              }}
              style={{
                marginTop: '16px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: '#ffffff',
                border: '1px solid #fecdd3',
                color: '#be123c',
                fontSize: '13px',
                fontWeight: '700',
                padding: '10px',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}
            >
              <LogOut size={14} />
              Disconnect Wallet
            </button>
          </div>
        ) : (
          /* Single Freighter Connection Card */
          <div style={{ marginBottom: '20px' }}>
            <button
              onClick={handleConnectFreighter}
              disabled={isConnecting}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '18px',
                background: '#ffffff',
                border: '1.5px solid #6366f1',
                borderRadius: '16px',
                cursor: isConnecting ? 'wait' : 'pointer',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.1)',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(99, 102, 241, 0.18)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.1)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)'
                }}>
                  <Wallet size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                    Freighter Wallet
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px' }}>
                    Official Stellar Extension
                  </div>
                </div>
              </div>

              <span style={{ fontSize: '13px', fontWeight: '800', color: '#6366f1' }}>
                {isConnecting ? 'Connecting...' : 'Connect →'}
              </span>
            </button>
          </div>
        )}

        {/* Security Note */}
        <div style={{ fontSize: '11.5px', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <Shield size={13} color="#94a3b8" />
          Pactum never accesses your private keys.
        </div>

      </div>
    </div>
  );
};

export default WalletConnectModal;
