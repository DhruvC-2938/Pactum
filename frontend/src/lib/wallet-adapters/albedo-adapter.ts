import type { WalletAdapter, AdapterMetadata } from './adapter-interface';

// Lazy-loaded Albedo API - will be imported on demand
let albedoApi: Awaited<ReturnType<typeof import('@albedo-link/intent')>> | null = null;

const getAlbedoApi = async () => {
  if (!albedoApi) {
    const mod = await import('@albedo-link/intent');
    albedoApi = mod;
  }
  return albedoApi;
};

export const AlbedoAdapter: WalletAdapter & { metadata: AdapterMetadata } = {
  name: 'Albedo',
  id: 'albedo',
  icon: {},
  description: 'Albedo Link wallet adapter',
  connect: async () => {
    const api = await getAlbedoApi();
    // TODO: Implement Albedo connection flow
    throw new Error('Albedo adapter connection not yet implemented');
  },
  disconnect: async () => {
    // TODO: Implement Albedo disconnection
  },
  isAvailable: async () => {
    try {
      const api = await getAlbedoApi();
      const { isAlbedoInstalled } = await api;
      return Boolean(isAlbedoInstalled());
    } catch {
      return false;
    }
  },
  metadata: {
    supportedChains: ['stellar-testnet', 'stellar-mainnet'],
    versions: {
      wallet: '0.1.0',
      adapter: '0.1.0'
    }
  }
};