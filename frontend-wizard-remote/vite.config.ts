import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'
import path from 'path'

// Independently compiled and deployed remote exposing CreateCommitmentWizard. See
// docs/module-federation.md for the overall host/remote architecture.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'wizard',
      filename: 'remoteEntry.js',
      // See frontend/vite.config.ts for why: ambient .d.ts declarations are hand-maintained here
      // instead of relying on generated cross-package types.
      dts: false,
      exposes: {
        './CreateCommitmentWizard': './src/CreateCommitmentWizard.tsx',
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
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5175,
    origin: 'http://localhost:5175',
    cors: true,
  },
  preview: {
    port: 5175,
    cors: true,
  },
  build: {
    target: 'esnext',
  },
})
