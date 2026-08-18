import type { WalletAdapter } from './adapter-interface';

// Lazy-loaded Freighter API - will be imported on demand
let freighterApi: Awaited<ReturnType<typeof import('@stellar/freighter-api')>> | null = null;

const getFreighterApi = async () => {
  if (!freighterApi) {
    const mod = await import('@stellar/freighter-api');
    freighterApi = mod;
  }
  return freighterApi;
};

export const FreighterAdapter: WalletAdapter = {
  name: 'Freighter',
  id: 'freighter',
  icon: {},
  description: 'Stellar wallet extension',
  connect: async () => {
    const api = await getFreighterApi();
    let installed = false;
    try {
      const connRes = await api.isConnected();
      installed = Boolean(connRes && connRes.isConnected);
    } catch {
      installed = typeof window !== 'undefined' && (window as any).freighter;
    }
    if (!installed && typeof window !== 'undefined' && (window as any).freighter) {
      installed = true;
    }
    if (!installed) {
      return null;
    }
    const { requestAccess } = await api;
    const accessRes = await requestAccess();
    if (accessRes && accessRes.address) {
      return accessRes.address;
    }
    const { getAddress } = await api;
    const addrRes = await getAddress();
    if (addrRes && addrRes.address && !addrRes.error) {
      return addrRes.address;
    }
    return null;
  },
  disconnect: async () => {
    localStorage.removeItem('pactum_freighter_connected');
  },
  isAvailable: async () => {
    try {
      const api = await getFreighterApi();
      const connRes = await api.isConnected();
      return Boolean(connRes && connRes.isConnected);
    } catch {
      return typeof window !== 'undefined' && (window as any).freighter;
    }
  }
};