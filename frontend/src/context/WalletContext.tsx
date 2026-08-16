import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { isConnected as checkIsConnected, requestAccess, setAllowed, getAddress } from '@stellar/freighter-api';

export interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  isInstalled: boolean;
  isConnecting: boolean;
  error: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'pactum_freighter_connected';

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-connect check on mount
  useEffect(() => {
    let isMounted = true;

    const checkAutoConnect = async () => {
      try {
        const wasConnected = localStorage.getItem(LOCAL_STORAGE_KEY) === 'true';
        if (wasConnected) {
          const addrResult = await getAddress();
          if (isMounted && addrResult?.address && !addrResult.error) {
            setAddress(addrResult.address);
          }
        }
      } catch (err) {
        console.warn('[WalletContext] Auto-connect error:', err);
      }
    };

    checkAutoConnect();

    return () => {
      isMounted = false;
    };
  }, []);

  const connectWallet = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // 1. Verify extension presence
      let installed = false;
      try {
        const connRes = await checkIsConnected();
        if (connRes && typeof connRes.isConnected === 'boolean') {
          installed = connRes.isConnected;
        }
      } catch (e) {
        // Fallback check
      }

      if (!installed && typeof window !== 'undefined' && (window as any).freighter) {
        installed = true;
      }

      if (!installed) {
        setIsInstalled(false);
        setError('Freighter browser extension was not detected. Please install Freighter from freighter.app.');
        setIsConnecting(false);
        return;
      }

      setIsInstalled(true);

      // 2. Multi-tiered resolution: requestAccess() -> setAllowed() + getAddress() -> window.freighter
      let userAddr = '';

      // Method A: Official requestAccess()
      try {
        const accessRes = await requestAccess();
        if (accessRes && accessRes.address) {
          userAddr = accessRes.address;
        } else if (typeof accessRes === 'string') {
          userAddr = accessRes;
        }
      } catch (e) {
        console.warn('[WalletContext] requestAccess failed, trying setAllowed/getAddress:', e);
      }

      // Method B: setAllowed() + getAddress()
      if (!userAddr) {
        try {
          await setAllowed();
          const addrRes = await getAddress();
          if (addrRes && addrRes.address && !addrRes.error) {
            userAddr = addrRes.address;
          } else if (typeof addrRes === 'string') {
            userAddr = addrRes;
          }
        } catch (e) {
          console.warn('[WalletContext] setAllowed/getAddress error:', e);
        }
      }

      // Method C: Direct window.freighter injection fallback
      if (!userAddr && typeof window !== 'undefined' && (window as any).freighter) {
        try {
          const directAddr = await (window as any).freighter.getAddress();
          if (directAddr) {
            userAddr = typeof directAddr === 'string' ? directAddr : directAddr.address || '';
          }
        } catch (e) {
          console.warn('[WalletContext] window.freighter fallback error:', e);
        }
      }

      if (userAddr) {
        setAddress(userAddr);
        localStorage.setItem(LOCAL_STORAGE_KEY, 'true');
      } else {
        setError('Connection request was denied or canceled in Freighter.');
      }
    } catch (err: any) {
      console.error('[WalletContext] Connection error:', err);
      setError(err?.message || 'Failed to connect with Freighter wallet.');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setAddress(null);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected: Boolean(address),
        isInstalled,
        isConnecting,
        error,
        connectWallet,
        disconnectWallet,
        clearError
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
