import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { themes } from '@/lib/theme/theme-registry';
import { defaultPreferences } from '@/lib/preferences/defaults';
import {
  acceptRemotePreferences,
  LEGACY_PREFERENCES_KEY,
  preferencesStorageKey,
  readPreferencesRecord,
} from '@/lib/preferences/local-storage';
import { applyPreferencesPatch, diffPreferences, mergePreferencesPatch, validatePreferences } from '@/lib/preferences/validation';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});

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

  it('builds field-level patches without overwriting unrelated preferences', () => {
    const changed = structuredClone(defaultPreferences);
    changed.appearance.themeId = 'stone-light';
    changed.schedule.density = 'compact';
    const first = diffPreferences(defaultPreferences, changed);
    const merged = mergePreferencesPatch(first, { schedule: { showSaturday: false } });
    expect(merged).toEqual({
      appearance: { themeId: 'stone-light' },
      schedule: { density: 'compact', showSaturday: false },
    });
    expect(applyPreferencesPatch(defaultPreferences, merged).schedule.showEmptyDays).toBe(true);
  });

  it('lets existing server preferences win during the legacy v1 migration', () => {
    const legacy = structuredClone(defaultPreferences);
    legacy.appearance.mode = 'dark';
    legacy.appearance.themeId = 'navy-electric';
    localStorage.setItem(LEGACY_PREFERENCES_KEY, JSON.stringify(legacy));

    const staged = readPreferencesRecord('ermolz');
    expect(staged.migration).toBe('legacy-v1');
    expect(localStorage.getItem(LEGACY_PREFERENCES_KEY)).not.toBeNull();

    const server = structuredClone(defaultPreferences);
    server.appearance.themeId = 'stone-light';
    const accepted = acceptRemotePreferences('ermolz', server, 4, true);
    expect(accepted.preferences.appearance.themeId).toBe('stone-light');
    expect(accepted.pendingPatch).toBeUndefined();
    expect(accepted.migration).toBeUndefined();
    expect(localStorage.getItem(LEGACY_PREFERENCES_KEY)).toBeNull();
  });

  it('initializes missing server preferences from legacy v1 without mixing users or semesters', () => {
    const legacy = structuredClone(defaultPreferences);
    legacy.schedule.density = 'compact';
    localStorage.setItem(LEGACY_PREFERENCES_KEY, JSON.stringify(legacy));

    readPreferencesRecord('ermolz');
    const accepted = acceptRemotePreferences('ermolz', defaultPreferences, 0, false);
    expect(accepted.preferences.schedule.density).toBe('compact');
    expect(accepted.pendingPatch?.schedule?.density).toBe('compact');
    expect(preferencesStorageKey('ermolz')).toBe('scheduler_preferences_v2:ermolz');
    expect(preferencesStorageKey('zahar')).toBe('scheduler_preferences_v2:zahar');
    expect(preferencesStorageKey('ermolz')).not.toContain('semester');
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

  it('keeps theme application independent from persistence and synchronization', () => {
    const source = readFileSync(new URL('../hooks/use-theme.ts', import.meta.url), 'utf8');
    expect(source).toContain('useTheme(appearance: AppearancePreferences)');
    expect(source).not.toMatch(/local-storage|repository|editToken|updatePreferences|SchedulerPreferences/);
  });
});
