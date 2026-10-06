import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const foodSrc = path.resolve(__dirname, './src/modules/Food')
const servicesApi = path.resolve(__dirname, './src/services/api')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@food/api/axios', replacement: path.resolve(servicesApi, 'axios.js') },
      { find: '@food/api/config', replacement: path.resolve(servicesApi, 'config.js') },
      { find: '@food/api', replacement: servicesApi },
      { find: '@food', replacement: foodSrc },
      { find: '@delivery', replacement: path.resolve(__dirname, './src/modules/DeliveryV2') },
      // Quick Commerce admin module support (ported from Blaze) — scoped additions only,
      // the Food aliases above are untouched.
      { find: '@core', replacement: path.resolve(__dirname, './src/core') },
      { find: '@shared', replacement: path.resolve(__dirname, './src/shared') },
      { find: '@common', replacement: path.resolve(__dirname, './src/modules/common') },
      { find: '@quickCommerce', replacement: path.resolve(__dirname, './src/modules/quickCommerce') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  optimizeDeps: {
    include: [
      '@emotion/react',
      '@emotion/styled',
      '@mui/material',
      '@mui/x-date-pickers',
    ],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api/v1': {
        target: process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:9000',
        changeOrigin: true,
      },
    },
  },
})