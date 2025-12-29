import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json']
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          tanstack: ['@tanstack/react-query'],
          i18n: ['i18next', 'react-i18next'],
          motion: ['framer-motion'],
          ui: [
            'lucide-react',
            'clsx',
            'tailwind-merge',
            'class-variance-authority',
            'cmdk',
            'vaul',
            'sonner',
            'next-themes',
          ],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          editor: ['react-quill', 'quill'],
          dates: ['date-fns', 'react-day-picker'],
          nacl: ['tweetnacl'],
          html2canvas: ['html2canvas'],
          jspdf: ['jspdf'],
          leaflet: ['leaflet', 'react-leaflet'],
          recharts: ['recharts'],
        },
      },
    },
  },
}) 