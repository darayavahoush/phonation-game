import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Root is this folder; allow reading the module one level up.
export default defineConfig({ plugins: [react()], server: { fs: { allow: ['..'] } } })
