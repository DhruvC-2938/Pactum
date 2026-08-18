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

export interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  isInstalled: boolean;
  isConnecting: boolean;
  error: string | null;
  connectWallet: (adapterId: string) => Promise<void>;
  disconnectWallet: () => void;
  clearError: () => void;
  availableAdapters: WalletConnectAdapter[];
  selectedAdapter: WalletConnectAdapter | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'pactum_connected_wallet';

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [availableAdapters, setAvailableAdapters] = useState<WalletConnectAdapter[]>([]);
  const [selectedAdapter, setSelectedAdapter] = useState<WalletConnectAdapter | null>(null);

  // Auto-connect check on mount
  useEffect(() => {
    let isMounted = true;

    const checkAutoConnect = async () => {
      try {
        const wasConnected = localStorage.getItem(LOCAL_STORAGE_KEY) === 'true';
        if (wasConnected) {
          const addrResult = await getAddressFromSelectedAdapter();
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
        setIsConnecting(false);
        return;
      }

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