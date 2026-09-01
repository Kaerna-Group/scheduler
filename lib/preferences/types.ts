import type {
  DarkThemeId,
  LightThemeId,
  ReducedMotionPreference,
  ThemeId,
  ThemeMode,
} from '@/lib/theme/theme-registry';

export type ScheduleDefaultView = 'today' | 'week' | 'subjects';
export type InitialWeekPreference = 'current' | 'last-opened';
export type CardDensity = 'comfortable' | 'compact';

export interface AppearancePreferences {
  mode: ThemeMode;
  themeId: ThemeId;
  systemLightThemeId: LightThemeId;
  systemDarkThemeId: DarkThemeId;
  reducedMotion: ReducedMotionPreference;
}

export interface ScheduleViewPreferences {
  defaultView: ScheduleDefaultView;
  initialWeek: InitialWeekPreference;
  showEmptyDays: boolean;
  density: CardDensity;
  highlightConflicts: boolean;
  showSaturday: boolean;
  rememberSubjectFilter: boolean;
  refreshOnOpen: boolean;
}

export interface SchedulerPreferences {
  version: 1;
  appearance: AppearancePreferences;
  schedule: ScheduleViewPreferences;
}

export type PreferencesPatch = {
  appearance?: Partial<AppearancePreferences>;
  schedule?: Partial<ScheduleViewPreferences>;
};

export interface CachedPreferences {
  preferences: SchedulerPreferences;
  preferencesRevision: number;
  pendingPatch?: PreferencesPatch;
  migration?: 'legacy-v1';
}

export type PreferencesSyncStatus = 'saved' | 'saving' | 'pending' | 'local' | 'error';
