import type { VitePWAOptions } from 'vite-plugin-pwa';

export const APP_BASE = '/scheduler/';

export const pwaOptions: Partial<VitePWAOptions> = {
  // Registration and updates are controlled by our UI, never by an injected script.
  injectRegister: false,
  registerType: 'prompt',
  scope: APP_BASE,
  devOptions: { enabled: false },
  includeAssets: [],
  includeManifestIcons: false,
  manifest: {
    id: APP_BASE,
    name: 'My Schedule',
    short_name: 'Schedule',
    description: 'Your personal university schedule, available offline.',
    lang: 'en',
    start_url: `${APP_BASE}#/`,
    scope: APP_BASE,
    display: 'standalone',
    background_color: '#fcfdfb',
    theme_color: '#24383b',
    icons: [
      {
        src: 'icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    cacheId: 'my-schedule-shell',
    // Only public, build-owned assets. In particular, no runtime API caching.
    globPatterns: [
      'index.html',
      'assets/*.{js,css}',
      'storage-migrations.js',
      'theme-init.js',
      'favicon.svg',
      'icons/*.png',
    ],
    navigateFallback: `${APP_BASE}index.html`,
    // Hash routing needs just the entry document, not arbitrary paths or API URLs.
    navigateFallbackAllowlist: [/^\/scheduler\/(?:index\.html)?(?:\?.*)?$/],
    runtimeCaching: [],
    // Precache activation removes obsolete entries in our own scoped cache.
    // Do not run Workbox's broader cleanup of other precache cache names.
    cleanupOutdatedCaches: false,
    skipWaiting: false,
    clientsClaim: false,
    inlineWorkboxRuntime: true,
  },
};
