import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const buildTime = new Date().toISOString()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Compost Monitor',
        short_name: 'Compost',
        description: 'Green Loop Compost Temperature Monitoring',
        theme_color: '#2D8B4E',
        background_color: '#f0fdf4',
        display: 'standalone',
        // A report link opened while the installed app is already showing another report must
        // load the new URL, not just bring the existing window (and the old report) forward.
        launch_handler: { client_mode: ['navigate-existing', 'auto'] },
        orientation: 'portrait',
        icons: [
          {
            src: 'fuller-light-logo.jpg',
            sizes: '192x192',
            type: 'image/jpeg',
          },
          {
            src: 'fuller-light-logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Activate new SW immediately and take over all open tabs — without these,
        // a new service worker would sit in "waiting" state until every tab of the
        // PWA is closed, which on home-screen PWAs almost never happens.
        skipWaiting: true,
        clientsClaim: true,
        // Never cache Netlify function responses — they must always hit the network
        // so writes/reads go straight to Google Sheets.
        // /impact/ report links are opened by businesses and from the collector app, often on a
        // device that already has this PWA cached. Serving them the cached app shell runs an old
        // bundle that may not know the route (it falls through to /dashboard), so always fetch
        // those pages fresh from the network.
        navigateFallbackDenylist: [/^\/\.netlify\/functions\//, /^\/impact\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'weather-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 6 * 60 * 60, // 6 hours
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
