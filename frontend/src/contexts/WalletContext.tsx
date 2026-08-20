import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import freighterApi from '@stellar/freighter-api'

export interface WalletState {
  /** The connected Stellar public key, or null if no wallet is connected. */
  address: string | null
  /** True once the initial Freighter availability/connection check has completed. */
  isReady: boolean
  /** True if the Freighter browser extension is installed. */
  isAvailable: boolean
  /** True if `address` is set. */
  isConnected: boolean
  /** Any error message from the last connect attempt. */
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  /**
   * Identity marker for this WalletContext *module instance*, not just its data. Module
   * Federation shares dependencies across the host and every remote by module identity, not by
   * "the same source code" — if a remote bundled its own copy of this file instead of consuming
   * the host's exposed one, `useContext()` there would silently read that copy's default value
   * (`undefined`, throwing in `useWallet`) rather than this Provider's. Every consumer reading
   * the same `contextModuleId` is a direct, referential proof that they share this one module
   * instance, not just similarly-behaving independent copies. See docs/module-federation.md.
   */
  contextModuleId: string
}

const WalletContext = createContext<WalletState | undefined>(undefined)

const WALLET_CONTEXT_MODULE_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `wallet-${Date.now()}-${Math.random()}`

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isAvailable, setIsAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await freighterApi.isConnected()
        if (cancelled) return
        setIsAvailable(!result.error)
        if (!result.error && result.isConnected) {
          const { address: connectedAddress, error: addressError } = await freighterApi.getAddress()
          if (!cancelled && !addressError && connectedAddress) {
            setAddress(connectedAddress)
          }
        }
      } catch {
        if (!cancelled) setIsAvailable(false)
      } finally {
        if (!cancelled) setIsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    try {
      const { address: connectedAddress, error: accessError } = await freighterApi.requestAccess()
      if (accessError) {
        setError(accessError.message ?? 'Failed to connect Freighter wallet')
        return
      }
      setAddress(connectedAddress)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Freighter wallet')
    }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null)
  }, [])

  const value = useMemo<WalletState>(
    () => ({
      address,
      isReady,
      isAvailable,
      isConnected: address !== null,
      error,
      connect,
      disconnect,
      contextModuleId: WALLET_CONTEXT_MODULE_ID,
    }),
    [address, isReady, isAvailable, error, connect, disconnect]
  )

  useEffect(() => {
    // VITE_E2E_DIAGNOSTICS, not DEV: this needs to be readable from a real production build
    // served via `vite preview` too (see tests/e2e/module-federation.spec.ts and
    // playwright.config.ts), since `import.meta.env.DEV` is false for any built bundle
    // regardless of --mode. Off by default in every real deployment.
    if (import.meta.env.VITE_E2E_DIAGNOSTICS === 'true') {
      ;(window as unknown as Record<string, unknown>).__PACTUM_WALLET_PROVIDER_MODULE_ID__ = WALLET_CONTEXT_MODULE_ID
    }
  }, [])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return ctx
}

export default WalletContext
