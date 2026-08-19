import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

import {
  type WalletAdapter,
  type AdapterStatus,
  type AdapterMetadata,
  FreighterAdapter,
  AlbedoAdapter,
} from '../lib/wallet-adapters/adapter-interface';

export type { WalletAdapter, AdapterStatus, AdapterMetadata };

const allAdapters: WalletAdapter[] = [FreighterAdapter, AlbedoAdapter];

export interface WalletConnectAdapter {
  adapter: WalletAdapter;
  status: AdapterStatus;
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  isAvailable: () => boolean;
  metadata: AdapterMetadata;
}
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
  connectWallet: (adapterId: string) => Promise<void>;
  errorCode: WalletErrorCode | null;
  connectWallet: (provider?: WalletProviderName) => Promise<void>;
  disconnectWallet: () => void;
  clearError: () => void;
  availableAdapters: WalletConnectAdapter[];
  selectedAdapter: WalletConnectAdapter | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'pactum_connected_wallet';
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
      (parsed.provider !== 'freighter' && parsed.provider !== 'albedo') ||
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
  const [availableAdapters, setAvailableAdapters] = useState<WalletConnectAdapter[]>([]);
  const [selectedAdapter, setSelectedAdapter] = useState<WalletConnectAdapter | null>(null);
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

  // Auto-connect check on mount: restore persisted session (public key only, no signatures)
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

      // Freighter: verify the extension is still installed & the account is still accessible.
      const installed = isFreighterInstalled();
      setIsInstalled(installed);
      if (!installed) return;

      try {
        const wasConnected = localStorage.getItem(LOCAL_STORAGE_KEY) === 'true';
        if (wasConnected) {
          const addrResult = await getAddressFromSelectedAdapter();
          if (isMounted && addrResult?.address && !addrResult.error) {
            setAddress(addrResult.address);
          }
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

  const getAddressFromSelectedAdapter = async (): Promise<{ address: string | null; error?: string }> => {
    if (!selectedAdapter) return { address: null };
    try {
      const address = await selectedAdapter.connect();
      return { address, error: undefined };
    } catch (err: any) {
      return { address: null, error: err?.message || 'Failed to get address' };
    }
  };

  const refreshAvailableAdapters = async () => {
    const adapters: WalletConnectAdapter[] = [];

    for (const adapter of allAdapters) {
      let isAvail = false;
      try {
        isAvail = await adapter.isAvailable();
      } catch {
        isAvail = false;
      }
      adapters.push({
        adapter,
        status: isAvail ? 'available' : 'unavailable',
        connect: () => adapter.connect(),
        disconnect: () => adapter.disconnect(),
        isAvailable: () => adapter.isAvailable(),
        metadata: adapter.metadata,
      });
    }

    setAvailableAdapters(adapters);
  };

  useEffect(() => {
    refreshAvailableAdapters();
  }, []);

  const connectWallet = async (adapterId: string) => {
    const adapter = allAdapters.find((a) => a.id === adapterId);
    if (!adapter) return;

    setIsConnecting(true);
    setError(null);

    try {
      const isAvail = await adapter.isAvailable();
      if (!isAvail) {
        setError(`${adapter.name} is not available`);
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

      setSelectedAdapter({
        adapter,
        status: 'connecting',
        connect: adapter.connect,
        disconnect: adapter.disconnect,
        isAvailable: adapter.isAvailable,
        metadata: adapter.metadata,
      });

      const address = await adapter.connect();
      setAddress(address);
      setIsInstalled(true);
      localStorage.setItem(LOCAL_STORAGE_KEY, 'true');
    } catch (err: any) {
      console.error('[WalletContext] Connection error:', err);
      setError(err?.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
      // Refresh adapters after connection attempt
      refreshAvailableAdapters();
    }
  };

  const disconnectWallet = () => {
    setAddress(null);
    setIsInstalled(false);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setSelectedAdapter(null);
  };

  const clearError = () => {
    setError(null);
  };
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
        availableAdapters,
        selectedAdapter,
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