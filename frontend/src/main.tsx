import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'
import { WalletProvider } from './context/WalletContext'
import ToastProvider from './components/ToastProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <App />
        <ToastProvider />
      </WalletProvider>
    </QueryClientProvider>
  </StrictMode>,
)
