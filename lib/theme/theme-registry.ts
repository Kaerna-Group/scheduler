export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;
export type ReducedMotionPreference = 'system' | 'reduce' | 'allow';

export const lightThemeIds = ['air-light', 'paper-current', 'stone-light', 'azure-notebook', 'sage-morning'] as const;
export const darkThemeIds = ['midnight-black', 'graphite-current', 'dusk-gray', 'navy-electric', 'plum-night'] as const;
export const themeIds = [...lightThemeIds, ...darkThemeIds] as const;

export type LightThemeId = (typeof lightThemeIds)[number];
export type DarkThemeId = (typeof darkThemeIds)[number];
export type ThemeId = (typeof themeIds)[number];

export interface ThemeDefinition {
  id: ThemeId;
  mode: ResolvedThemeMode;
  name: string;
  description: string;
  preview: {
    background: string;
    surface: string;
    foreground: string;
    accent: string;
    border: string;
  };
}

export const themes: ThemeDefinition[] = [
  { id: 'air-light', mode: 'light', name: 'Повітря', description: 'Найсвітліша й найчистіша', preview: { background: '#fcfdfb', surface: '#ffffff', foreground: '#202b2e', accent: '#ee9363', border: '#e2e9e5' } },
  { id: 'paper-current', mode: 'light', name: 'Теплий папір', description: 'Звичне тепле оформлення', preview: { background: '#f7f3e8', surface: '#fffefb', foreground: '#293638', accent: '#e9915e', border: '#e3dfd5' } },
  { id: 'stone-light', mode: 'light', name: 'Світлий камінь', description: 'Щільна спокійна палітра', preview: { background: '#eceae4', surface: '#f6f4ef', foreground: '#252d2f', accent: '#c9784f', border: '#d1cdc3' } },
  { id: 'azure-notebook', mode: 'light', name: 'Блакитний зошит', description: 'Холодне синє оформлення', preview: { background: '#f3f7fc', surface: '#fbfdff', foreground: '#1e2b3b', accent: '#3273b2', border: '#d4dfeb' } },
  { id: 'sage-morning', mode: 'light', name: 'Шавлієвий ранок', description: 'Спокійна зелена палітра', preview: { background: '#f5f8f2', surface: '#fcfefa', foreground: '#243027', accent: '#709a68', border: '#d7e2d3' } },
  { id: 'midnight-black', mode: 'dark', name: 'Опівніч', description: 'Найглибша темна тема', preview: { background: '#080a0d', surface: '#11151a', foreground: '#f4f7fa', accent: '#ff9866', border: '#27303a' } },
  { id: 'graphite-current', mode: 'dark', name: 'Графіт', description: 'Нейтральна темна тема', preview: { background: '#252525', surface: '#333333', foreground: '#fafafa', accent: '#b4b4b4', border: '#494949' } },
  { id: 'dusk-gray', mode: 'dark', name: 'Сірі сутінки', description: 'М’якша сіра темна тема', preview: { background: '#24282b', surface: '#30363a', foreground: '#f4f5f3', accent: '#e19a70', border: '#4a5357' } },
  { id: 'navy-electric', mode: 'dark', name: 'Електрична ніч', description: 'Глибока синя тема', preview: { background: '#091525', surface: '#10233a', foreground: '#eef6ff', accent: '#48c6d9', border: '#294663' } },
  { id: 'plum-night', mode: 'dark', name: 'Сливова ніч', description: 'Сливово-теракотова тема', preview: { background: '#1a1020', surface: '#291a31', foreground: '#f8f0fa', accent: '#f09a68', border: '#503457' } },
];

export const themeById = new Map(themes.map((theme) => [theme.id, theme]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && themeById.has(value as ThemeId);
}

export function isLightThemeId(value: unknown): value is LightThemeId {
  return typeof value === 'string' && (lightThemeIds as readonly string[]).includes(value);
}

export function isDarkThemeId(value: unknown): value is DarkThemeId {
  return typeof value === 'string' && (darkThemeIds as readonly string[]).includes(value);
}
