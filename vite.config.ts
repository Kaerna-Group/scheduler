import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_BASE, pwaOptions } from './pwa.config.ts';

export default defineConfig({
  base: APP_BASE,
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react(), VitePWA(pwaOptions)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
