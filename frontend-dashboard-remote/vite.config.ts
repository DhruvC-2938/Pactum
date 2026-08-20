import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'

// Independently compiled and deployed remote exposing ReputationDashboard. See
// docs/module-federation.md for the overall host/remote architecture and why `react`,
// `react-dom`, and `@tanstack/react-query` are marked `shared: { singleton: true }` here while
// WalletContext/queryClient are consumed via `remotes` instead.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'dashboard',
      filename: 'remoteEntry.js',
      // See frontend/vite.config.ts for why: ambient .d.ts declarations are hand-maintained here
      // instead of relying on generated cross-package types.
      dts: false,
      exposes: {
        './ReputationDashboard': './src/ReputationDashboard.tsx',
      },
      remotes: {
        host: {
          type: 'module',
          name: 'host',
          entry: 'http://localhost:5173/remoteEntry.js',
          entryGlobalName: 'host',
          shareScope: 'default',
        },
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.8' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.8' },
        '@tanstack/react-query': { singleton: true, requiredVersion: '^5.101.4' },
      },
    }),
  ],
  server: {
    port: 5174,
    origin: 'http://localhost:5174',
    cors: true,
  },
  preview: {
    port: 5174,
    cors: true,
  },
  build: {
    target: 'esnext',
  },
})
