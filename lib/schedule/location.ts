export type ScheduleView = 'week' | 'today' | 'subjects';
export interface ScheduleLocation {
  view?: ScheduleView;
  week?: number;
  user?: string;
  semester?: string;
  subject?: string;
  explicit: boolean;
  warnings: string[];
}
export interface ScheduleLinkState {
  view: ScheduleView;
  week: number;
  user: string;
  semester: string;
  subject?: string;
}

function hasControlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function pagePath(href: string) {
  const hash = new URL(href).hash.slice(1).split('?')[0];
  return hash.replace(/\/$/, '') || '/';
}

export function parseScheduleLocation(href: string): ScheduleLocation | null {
  const url = new URL(href);
  const path = pagePath(href);
  const weekPath = /^\/week(?:\/([^/]+))?$/.exec(path);
  const view = weekPath
    ? 'week'
    : path === '/today'
      ? 'today'
      : ['/courses', '/subjects'].includes(path)
        ? 'subjects'
        : undefined;
  if (path !== '/' && !view) return null;
  const query = new URLSearchParams(
    url.hash.slice(1).split('?').slice(1).join('?'),
  );
  const get = (name: string) =>
    query.has(name) ? query.get(name) : url.searchParams.get(name);
  const warnings: string[] = [];
  const weekValue = weekPath?.[1] ?? get('week');
  const week =
    weekValue &&
    /^\d+$/.test(weekValue) &&
    Number.isSafeInteger(Number(weekValue)) &&
    Number(weekValue) >= 1
      ? Number(weekValue)
      : undefined;
  if (weekValue !== null && weekValue !== undefined && week === undefined)
    warnings.push('The link contains an invalid week.');
  function identifier(name: string, pattern: RegExp) {
    const value = get(name);
    if (value === null) return undefined;
    if (!pattern.test(value) || hasControlCharacters(value)) {
      warnings.push(`The link contains an invalid ${name}.`);
      return undefined;
    }
    return value;
  }
  const user = identifier('user', /^[a-z0-9][a-z0-9-]{1,39}$/);
  const semester = identifier('semester', /^[A-Z0-9-]{4,48}$/);
  const subject = identifier('subject', /^.{1,160}$/u);
  const explicit =
    Boolean(view) ||
    ['week', 'user', 'semester', 'subject'].some((name) => get(name) !== null);
  return {
    view: view ?? (week !== undefined ? 'week' : undefined),
    week,
    user,
    semester,
    subject,
    explicit,
    warnings,
  };
}

export function scheduleHash(state: ScheduleLinkState) {
  const query = new URLSearchParams();
  query.set('user', state.user);
  query.set('semester', state.semester);
  if (state.view !== 'week') query.set('week', String(state.week));
  if (state.subject && state.subject !== 'all')
    query.set('subject', state.subject);
  const path =
    state.view === 'week'
      ? `/week/${state.week}`
      : state.view === 'subjects'
        ? '/courses'
        : '/today';
  return `#${path}?${query}`;
}

export function scheduleUrl(href: string, state: ScheduleLinkState) {
  const url = new URL(href);
  // Only share the explicit allowlist of viewing state. Never propagate tokens,
  // PINs, arbitrary query parameters, or credentials from the current URL.
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = scheduleHash(state);
  return url.href;
}
