import { ApiError, postApi } from '@/lib/api/client';
import type { PreferencesPatch, SchedulerPreferences } from '@/lib/preferences/types';

export interface PreferencesResponse {
  preferences: SchedulerPreferences;
  preferencesRevision: number;
}

export function getStalePreferences(error: unknown): PreferencesResponse | null {
  if (!(error instanceof ApiError) || error.code !== 'SETTINGS_STALE' || !error.details || typeof error.details !== 'object') return null;
  const details = error.details as { preferences?: unknown; preferencesRevision?: unknown };
  if (!details.preferences || !Number.isInteger(details.preferencesRevision)) return null;
  return { preferences: details.preferences as SchedulerPreferences, preferencesRevision: Number(details.preferencesRevision) };
}

export function updatePreferences(args: {
  userSlug: string;
  token: string;
  baseSettingsRevision: number;
  patch: PreferencesPatch;
}) {
  return postApi<PreferencesResponse>({
    action: 'updatePreferences',
    userSlug: args.userSlug,
    editToken: args.token,
    baseSettingsRevision: args.baseSettingsRevision,
    patch: args.patch,
  });
}
