import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      // 本地开发：/image-records 代理到 scripts/dev-server.mjs 的边缘函数模拟器（生产由 EdgeOne 边缘函数承接）
      '/image-records': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})
