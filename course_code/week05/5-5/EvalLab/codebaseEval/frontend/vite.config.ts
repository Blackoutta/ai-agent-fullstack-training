import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': { target: loadEnv(mode, '.', 'EVAL_').EVAL_API_TARGET || 'http://127.0.0.1:8765', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    clearMocks: true,
    include: ['tests/**/*.spec.ts'],
  },
}))
