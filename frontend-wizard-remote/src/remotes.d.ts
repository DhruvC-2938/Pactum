/// <reference types="vite/client" />

// Ambient declarations for modules resolved at runtime by Module Federation, which TypeScript
// cannot see through statically. Kept intentionally narrow (only the exports this remote
// actually imports) rather than `declare module 'host/*'`, so a typo or a real drift from the
// host's exposed API surface still shows up as a type error here.
//
// Deliberately no top-level import/export in this file: that would make it a module, and a
// module's `declare module 'literal'` blocks stop being seen as global ambient declarations
// under this project's compiler options (confirmed empirically — see the sibling remote's
// identical file for the same fix). Use inline `import('pkg').Type` instead.
declare module 'host/WalletContext' {
  export interface WalletState {
    address: string | null
    isReady: boolean
    isAvailable: boolean
    isConnected: boolean
    error: string | null
    connect: () => Promise<void>
    disconnect: () => void
    contextModuleId: string
  }
  export function useWallet(): WalletState
  export function WalletProvider(props: { children: import('react').ReactNode }): import('react').ReactElement
}

declare module 'host/queryClient' {
  import type { QueryClient } from '@tanstack/react-query'
  export const queryClient: QueryClient
}
