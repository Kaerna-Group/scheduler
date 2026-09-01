import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { themes } from '@/lib/theme/theme-registry';
import { defaultPreferences, validatePreferences } from '@/lib/theme/theme-storage';

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('theme preferences', () => {
  it('registers five light and five dark themes', () => {
    expect(themes.filter((theme) => theme.mode === 'light')).toHaveLength(5);
    expect(themes.filter((theme) => theme.mode === 'dark')).toHaveLength(5);
  });

  it('falls back safely from damaged or unknown values', () => {
    expect(validatePreferences(null)).toEqual(defaultPreferences);
    expect(validatePreferences({
      version: 99,
      appearance: { mode: 'broken', themeId: 'unknown', reducedMotion: 'spin' },
      schedule: { defaultView: 'matrix', showEmptyDays: 'yes' },
    })).toEqual(defaultPreferences);
  });

  it('keeps valid choices while filling missing settings', () => {
    const preferences = validatePreferences({
      version: 1,
      appearance: { mode: 'dark', themeId: 'navy-electric' },
      schedule: { defaultView: 'today', density: 'compact', showEmptyDays: false },
    });
    expect(preferences.appearance.mode).toBe('dark');
    expect(preferences.appearance.themeId).toBe('navy-electric');
    expect(preferences.schedule).toMatchObject({ defaultView: 'today', density: 'compact', showEmptyDays: false });
    expect(preferences.schedule.refreshOnOpen).toBe(true);
  });

  it('provides readable preview text in every theme', () => {
    themes.forEach((theme) => {
      expect(contrast(theme.preview.foreground, theme.preview.background), theme.name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.preview.foreground, theme.preview.surface), theme.name).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('applies the saved theme before the React entry script', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html.indexOf('theme-init.js')).toBeGreaterThan(-1);
    expect(html.indexOf('theme-init.js')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });

  it('does not leave direct palette utility classes in application screens', () => {
    const files = [
      '../components/schedule/schedule-app.tsx',
      '../components/schedule/import-guide-page.tsx',
      '../components/access/access-gate.tsx',
      '../components/settings/settings-page.tsx',
      '../components/settings/theme-card.tsx',
    ];
    files.forEach((path) => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source, path).not.toMatch(/(?:bg|text|border)-\[#[0-9a-f]{3,8}\]/i);
      expect(source, path).not.toMatch(/\b(?:bg-white|text-white)\b/);
    });
  });

  it('keeps settings section navigation inside the settings route', () => {
    const source = readFileSync(new URL('../components/settings/settings-page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('scrollIntoView');
    expect(source).not.toContain('href={`#${id}`}');
  });
});
