import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Buffer } from 'buffer';
import './index.css';

if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}
import App from './App.tsx';
import { queryClient } from './lib/queryClient';
import { WalletProvider } from './context/WalletContext';
import { ThemeProvider } from './context/ThemeContext';
import { IndexerModeProvider } from './context/IndexerModeContext';
import { initSentry } from './lib/sentry';
import { SentryErrorBoundary } from './components/SentryErrorBoundary';

// Initialise frontend error monitoring (Issue #210) before the tree renders so
// Sentry can capture unhandled promise rejections, global errors and component
// crashes from the very first frame. No-op unless VITE_SENTRY_DSN is configured.
initSentry();

// WalletProvider and QueryClientProvider wrap the whole tree here, in the host, exactly once —
// not per-remote — since the host owns the single WalletContext and QueryClient instances that
// dashboard/wizard remotes consume over Module Federation (see vite.config.ts `exposes` and
// docs/module-federation.md). A remote wrapping itself in its own instance of either provider
// would defeat the singleton sharing this architecture depends on.
createRoot(document.getElementById('root')!).render(
  <SentryErrorBoundary>
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <ThemeProvider>
            <IndexerModeProvider>
              <App />
            </IndexerModeProvider>
          </ThemeProvider>
        </WalletProvider>
      </QueryClientProvider>
    </StrictMode>
  </SentryErrorBoundary>,
);
