import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

// Root is this folder; the app imports modules one level up (../ui, ../PhonationEngine.js), which have no node_modules
// of their own, so pin react to this folder's copy.
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^react$/, replacement: here('./node_modules/react/index.js') },
      { find: /^react\/(.*)$/, replacement: here('./node_modules/react/$1') },
      { find: /^react-dom$/, replacement: here('./node_modules/react-dom/index.js') },
      { find: /^react-dom\/(.*)$/, replacement: here('./node_modules/react-dom/$1') },
    ],
  },
  build: { assetsInlineLimit: 0 }, // emit the audio worklet as a real file (a data: URL is flaky in Safari)
  server: { fs: { allow: ['..'] } },
})
