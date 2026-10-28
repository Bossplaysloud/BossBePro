/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * alphaTab draws a "rendered by alphaTab" line under every score, with no setting to turn it off.
 * BePro lays out its own pages, so that step is skipped (alphaTab is credited in Settings → About).
 */
const hideAlphaTabAnnotation = {
  name: 'bepro-hide-alphatab-annotation',
  transform(code: string, id: string) {
    if (!id.includes('@coderline/alphatab') || !code.includes('rendered by alphaTab')) return null
    return { code: code.replace('_layoutAndRenderAnnotation(y) {', '_layoutAndRenderAnnotation(y) { return y;'), map: null }
  },
}

export default defineConfig({
  base: './',
  plugins: [
    hideAlphaTabAnnotation,
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'BePro',
        short_name: 'BePro',
        description: 'String instrument practice & score notebook',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // CJK font files are large and split by unicode-range: cache them on first use instead of precaching all.
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/carlito-*.woff2', 'alphatab/font/Bravura.woff2', 'alphatab/soundfont/sonivox.sf2', 'assets/alphaTab.*.mjs'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('noto-sans-tc'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts-cjk', expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
  // Pre-bundling would move alphaTab away from its worker files (resolved relative to the module) in dev.
  optimizeDeps: { exclude: ['@coderline/alphatab'] },
  test: {
    environment: 'node',
  },
})
