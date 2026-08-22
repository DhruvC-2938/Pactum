/* eslint-disable react-refresh/only-export-components */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  connectWallet as connectWithProvider,
  getFreighterAddress,
  isFreighterInstalled,
  isFreighterConnected,
  WalletConnectionError,
  type WalletErrorCode,
  type WalletProvider as WalletProviderName,
} from '../lib/wallet';

export interface WalletContextType {
  address: string | null;
  provider: WalletProviderName | null;
  isConnected: boolean;
  isInstalled: boolean;
  isConnecting: boolean;
  error: string | null;
  errorCode: WalletErrorCode | null;
  connectWallet: (provider?: WalletProviderName) => Promise<void>;
  disconnectWallet: () => void;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'pactum_wallet_state';

interface PersistedWalletState {
  provider: WalletProviderName | null;
  address: string;
}

function loadPersistedState(): PersistedWalletState | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWalletState;
    if (
      !parsed ||
      (parsed.provider !== 'freighter' &&
        parsed.provider !== 'albedo' &&
        parsed.provider !== 'ledger') ||
      !parsed.address
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[WalletContext] Failed to parse persisted state:', err);
    return null;
  }
}

function persistState(provider: WalletProviderName, address: string): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ provider, address }));
  } catch (err) {
    console.warn('[WalletContext] Failed to persist wallet state:', err);
  }
}

function clearPersistedState(): void {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch (err) {
    console.warn('[WalletContext] Failed to clear persisted state:', err);
  }
}

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<WalletProviderName | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<WalletErrorCode | null>(null);

  const applyError = useCallback((err: unknown) => {
    if (err instanceof WalletConnectionError) {
      setErrorCode(err.code);
      setError(err.message);
    } else {
      setErrorCode('UNKNOWN');
      setError(err instanceof Error ? err.message : 'Failed to connect with wallet.');
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);

  // Auto-connect check on mount: restore persisted session (public key only, no signatures).
  // Ledger/hardware sessions are never auto-restored since they require a fresh
  // device connection prompt each time.
  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      const persisted = loadPersistedState();
      if (!persisted) return;

      if (persisted.provider === 'albedo') {
        // Albedo is web-based; the public key is public info, safe to restore.
        if (isMounted) {
          setAddress(persisted.address);
          setProvider('albedo');
        }
        return;
      }

      if (persisted.provider === 'ledger') {
        // Hardware wallets require an explicit reconnect (USB/BLE prompt).
        return;
      }

      // Freighter: verify the extension is still installed & the account is still accessible.
      const installed = isFreighterInstalled();
      setIsInstalled(installed);
      if (!installed) return;

      try {
        const connected = await isFreighterConnected();
        if (!connected) return;

        const addrRes = await getFreighterAddress();
        if (isMounted && addrRes?.address && !addrRes.error) {
          setAddress(addrRes.address);
          setProvider('freighter');
        }
      } catch (err) {
        console.warn('[WalletContext] Auto-connect error:', err);
      }
    };

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const connectWallet = useCallback(
    async (walletProvider: WalletProviderName = 'freighter') => {
      setIsConnecting(true);
      setError(null);
      setErrorCode(null);

      try {
        if (walletProvider === 'freighter') {
          setIsInstalled(isFreighterInstalled());
        }

        const result = await connectWithProvider(walletProvider);

        setAddress(result.address);
        setProvider(result.provider);
        persistState(result.provider, result.address);
      } catch (err) {
        console.error(`[WalletContext] Connection error (${walletProvider}):`, err);
        applyError(err);
      } finally {
        setIsConnecting(false);
      }
    },
    [applyError],
  );

  const disconnectWallet = useCallback(() => {
    setAddress(null);
    setProvider(null);
    clearPersistedState();
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        provider,
        isConnected: Boolean(address),
        isInstalled,
        isConnecting,
        error,
        errorCode,
        connectWallet,
        disconnectWallet,
        clearError,
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
