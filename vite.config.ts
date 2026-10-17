import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // service worker propio (src/sw.ts) para recibir imágenes compartidas desde otras apps
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'Calculadora',
        short_name: 'Calc',
        description: 'Calculadora científica con fasores y formatos de salida a medida',
        lang: 'es',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        background_color: '#f6f6f9',
        theme_color: '#4f46e5',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Aparece en el menú «Compartir» de Android; lo recibe src/sw.ts
        share_target: {
          action: 'compartir',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            files: [{ name: 'image', accept: ['image/*'] }],
          },
        },
      },
    }),
  ],
});
