import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Root is this folder; the module (engine + ui/) lives one level up.
// Files up there import 'react', which is installed here, so tell Vite to
// resolve React from this folder for every importer. Without `dedupe` those
// imports fail ("react could not be resolved") because no node_modules sits above them.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: ['..'] } },
})
