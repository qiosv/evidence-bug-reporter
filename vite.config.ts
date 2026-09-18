import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  envDir: resolve(__dirname, 'src/renderer'),
  envPrefix: 'VITE_',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/fixtures': 'http://localhost:8787'
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true
  }
})
