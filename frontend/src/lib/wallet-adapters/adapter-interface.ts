export interface WalletAdapter {
  name: string;
  id: string;
  icon: any;
  description: string;
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  isAvailable: () => boolean;
}

export type AdapterStatus = 'available' | 'unavailable' | 'connecting' | 'connected';

export interface AdapterMetadata {
  supportedChains: string[];
  versions: {
    wallet: string;
    adapter: string;
  };
}