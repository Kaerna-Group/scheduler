import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Browser scenarios are deliberately local-only and run through Playwright.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { include: ['tests/**/*.test.{ts,tsx}'] },
  }),
);
