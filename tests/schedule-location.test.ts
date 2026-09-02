import { describe, expect, it } from 'vitest';
import {
  pagePath,
  parseScheduleLocation,
  scheduleHash,
  scheduleUrl,
} from '@/lib/schedule/location';
import type { ScheduleLinkState } from '@/lib/schedule/location';

const base = 'https://kaerna-group.github.io/scheduler/';
const state: ScheduleLinkState = {
  view: 'week',
  week: 6,
  user: 'ermolz',
  semester: 'SEM-2026-FALL',
  subject: '565095',
};
describe('schedule link format', () => {
  it('accepts a short week path and a fully specified share link', () => {
    expect(parseScheduleLocation(base + '#/week/5')).toMatchObject({
      view: 'week',
      week: 5,
      explicit: true,
      warnings: [],
    });
    const link = scheduleUrl(base, state);
    expect(link).toBe(
      base + '#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095',
    );
    expect(parseScheduleLocation(link)).toMatchObject({
      ...state,
      explicit: true,
      warnings: [],
    });
  });
  it.each(['week', 'today', 'subjects'] as const)(
    'round-trips %s and percent-encoded subject identifiers',
    (view) => {
      const input = { ...state, view, subject: 'Курс & A/B + C?' };
      expect(parseScheduleLocation(scheduleUrl(base, input))).toMatchObject(
        input,
      );
    },
  );
  it('accepts query forms, with path/hash values taking precedence', () => {
    expect(
      parseScheduleLocation(
        base +
          '?week=3&user=other&subject=old#/week/6?week=4&user=ermolz&subject=all',
      ),
    ).toMatchObject({ view: 'week', week: 6, user: 'ermolz', subject: 'all' });
    expect(parseScheduleLocation(base + '?week=5&user=ermolz')).toMatchObject({
      week: 5,
      view: 'week',
      user: 'ermolz',
    });
    expect(
      parseScheduleLocation(base + '#/?week=5&subject=565095'),
    ).toMatchObject({ week: 5, subject: '565095' });
    expect(parseScheduleLocation(base + '#?week=5')).toMatchObject({ week: 5 });
  });
  it.each([
    '0',
    '-2',
    '1.5',
    'NaN',
    'Infinity',
    '3oops',
    '9007199254740992',
    '',
  ])('rejects malformed week %j without throwing', (week) => {
    const route = parseScheduleLocation(base + '#/week?week=' + week);
    expect(route?.week).toBeUndefined();
    expect(route?.warnings).toContain('The link contains an invalid week.');
  });
  it('leaves valid out-of-range weeks for validation against the loaded semester', () => {
    expect(parseScheduleLocation(base + '#/week/999')?.week).toBe(999);
  });
  it.each([
    '#/settings?user=ermolz',
    '#/import',
    '#/changes',
    '#/admin',
    '#thursday',
  ])('does not interpret another page/anchor as schedule state: %s', (hash) => {
    expect(parseScheduleLocation(base + hash)).toBeNull();
    expect(pagePath(base + hash)).toBe(hash.slice(1).split('?')[0]);
  });
  it('ignores malformed identifiers and control characters', () => {
    const route = parseScheduleLocation(
      base + '#/week/6?user=../admin&semester=unknown&subject=%00',
    );
    expect(route?.user).toBeUndefined();
    expect(route?.semester).toBeUndefined();
    expect(route?.subject).toBeUndefined();
    expect(route?.warnings).toHaveLength(3);
  });
  it('allows local preferences only when the URL has no explicit viewing state', () => {
    expect(parseScheduleLocation(base)?.explicit).toBe(false);
    expect(parseScheduleLocation(base + '#/')?.explicit).toBe(false);
    expect(parseScheduleLocation(base + '#/week')?.explicit).toBe(true);
  });
  it('omits all-courses and excludes credentials and unrelated URL parameters', () => {
    expect(scheduleHash({ ...state, subject: 'all' })).not.toContain(
      'subject=',
    );
    const url = scheduleUrl(
      'https://login:password@example.test/scheduler/?token=secret&pin=1234#/admin?editToken=hidden',
      state,
    );
    expect(url).toBe('https://example.test/scheduler/' + scheduleHash(state));
    expect(url).not.toMatch(/password|login|token|pin|admin|secret|hidden/i);
  });
});
