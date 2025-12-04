// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'pair touch',
        short_name: 'pair touch',
        start_url: '/',
        display: 'standalone',
        theme_color: '#ffffff',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },

      // 🔽 ここがポイント
      workbox: {
        // デフォルトで /index.html にフォールバックする設定をしている場合でも、
        // Firebase Auth のパスだけは SW の管轄外にする
        navigateFallbackDenylist: [
          /\/__\/auth\//,   // Firebase Auth が使うパスを除外
        ],
      },
    }),
  ],
})