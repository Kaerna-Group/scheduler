// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextLessonBanner } from '@/components/schedule/next-lesson-banner';
import { fallbackSchedule } from '@/data/fallback-schedule';
import type { UserSchedule } from '@/lib/schedule/types';

let data: UserSchedule;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-23T11:03:30+03:00'));
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  data = structuredClone(fallbackSchedule);
  data.subjects = [
    {
      id: 'electronics',
      shortName: 'Електроніка',
      name: 'Електроніка та схемотехніка',
      selectedGroup: 5,
      color: '#123456',
    },
  ];
  data.lessons = [
    {
      id: 'one',
      subjectId: 'electronics',
      type: 'group',
      group: 5,
      day: 'wednesday',
      startTime: '11:40',
      endTime: '13:00',
      weeks: [4],
      room: '1-001',
      format: 'offline',
      teacher: 'Teacher',
    },
  ];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function show(props: Partial<Parameters<typeof NextLessonBanner>[0]> = {}) {
  return render(
    <NextLessonBanner
      schedule={data}
      source="remote"
      loading={false}
      ready
      online
      backendError={false}
      {...props}
    />,
  );
}
const banner = () =>
  within(screen.getByRole('region', { name: 'Найближча пара' }));

describe('compact next lesson banner', () => {
  it('shows the requested useful details without buttons or a separate page', () => {
    show();
    expect(banner().getByText('Наступна:')).toBeTruthy();
    expect(banner().getByText('Електроніка')).toBeTruthy();
    expect(banner().getByText('11:40')).toBeTruthy();
    expect(banner().getByText('1-001')).toBeTruthy();
    expect(banner().getByText('· через 37 хв')).toBeTruthy();
    expect(banner().getByText('Сьогодні · Київ')).toBeTruthy();
    expect(banner().queryAllByRole('button')).toHaveLength(0);
  });

  it('aligns countdown refreshes with real minute boundaries and cleans up its timer', () => {
    const { unmount } = show();
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(banner().getByText('· через 37 хв')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(banner().getByText('· через 36 хв')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.focus(window);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('automatically moves from upcoming to ongoing to done at exact boundaries', () => {
    vi.setSystemTime(new Date('2026-09-23T11:39:59+03:00'));
    show();
    expect(banner().getByText('· через 1 хв')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(banner().getByText('Зараз:')).toBeTruthy();
    expect(banner().getByText('11:40–13:00')).toBeTruthy();
    expect(banner().getByText('· ще 1 год 20 хв')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(80 * 60_000);
    });
    expect(banner().getByText('На сьогодні все')).toBeTruthy();
    expect(banner().queryByText('Електроніка')).toBeNull();
  });

  it('refreshes immediately after sleep/focus and pauses work in a hidden tab', () => {
    show();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date('2026-09-23T12:00:00+03:00'));
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(banner().getByText('· ще 1 год')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(new Date('2026-09-23T13:00:00+03:00'));
    fireEvent.focus(window);
    expect(banner().getByText('На сьогодні все')).toBeTruthy();
    vi.setSystemTime(new Date('2026-09-30T11:03:00+03:00'));
    fireEvent(window, new Event('pageshow'));
    expect(banner().getByText('Сьогодні пар немає')).toBeTruthy();
  });

  it('recomputes the day/week at university midnight without reloading', () => {
    vi.setSystemTime(new Date('2026-09-22T23:59:59+03:00'));
    show();
    expect(banner().getByText('Сьогодні пар немає')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(banner().getByText('Наступна:')).toBeTruthy();
    expect(banner().getByText('· через 11 год 40 хв')).toBeTruthy();
  });

  it.each([
    {
      source: 'cache' as const,
      online: false,
      label: 'Офлайн · збережені дані',
    },
    { source: 'cache' as const, online: true, label: 'Збережені дані' },
    { source: 'fallback' as const, online: false, label: 'Приклад розкладу' },
    {
      source: 'remote' as const,
      online: true,
      backendError: true,
      label: 'Збережені дані',
    },
  ])('labels snapshot freshness honestly: $label', ({ label, ...props }) => {
    show(props);
    expect(banner().getByText(`· ${label}`)).toBeTruthy();
    expect(banner().getByText('Наступна:')).toBeTruthy();
  });

  it('never shows an unrelated lesson while the selected user/semester is loading or unavailable', () => {
    const { rerender } = show({ loading: true, ready: false });
    expect(banner().getByText('Оновлюємо розклад…')).toBeTruthy();
    expect(banner().queryByText('Електроніка')).toBeNull();
    rerender(
      <NextLessonBanner
        schedule={data}
        source="fallback"
        loading={false}
        ready={false}
        online
        backendError
      />,
    );
    expect(banner().getByText('Розклад недоступний')).toBeTruthy();
    expect(banner().queryByText('На сьогодні все')).toBeNull();
  });

  it.each([
    { format: 'online' as const, room: undefined, label: 'Онлайн' },
    { format: 'hybrid' as const, room: '2-123', label: 'Гібрид · 2-123' },
    {
      format: 'offline' as const,
      room: undefined,
      label: 'Аудиторію не вказано',
    },
  ])('shows the lesson location/format: $label', ({ format, room, label }) => {
    data.lessons[0] = { ...data.lessons[0], format, room };
    show();
    expect(banner().getByText(label)).toBeTruthy();
  });

  it('shows all simultaneous classes instead of arbitrarily choosing one', () => {
    data.subjects.push({
      id: 'two',
      shortName: 'Безпека',
      name: 'Безпека',
      color: '#654321',
    });
    data.lessons.push({
      ...data.lessons[0],
      id: 'two',
      subjectId: 'two',
      type: 'lecture',
      room: '2-222',
    });
    show();
    expect(banner().getByText('· Одночасні пари')).toBeTruthy();
    expect(banner().getByText('Електроніка')).toBeTruthy();
    expect(banner().getByText('Безпека')).toBeTruthy();
    expect(banner().getByText('2-222')).toBeTruthy();
  });

  it('shows an ongoing and an upcoming class together without prematurely ending the day', () => {
    data.lessons.push({
      ...data.lessons[0],
      id: 'later',
      startTime: '15:00',
      endTime: '16:20',
    });
    vi.setSystemTime(new Date('2026-09-23T12:30:00+03:00'));
    show();
    expect(banner().getByText('Зараз:')).toBeTruthy();
    expect(banner().getByText('Наступна:')).toBeTruthy();
    expect(banner().queryByText('На сьогодні все')).toBeNull();
  });

  it('recomputes immediately when the selected semester or schedule snapshot changes', () => {
    const { rerender } = show();
    const updated = { ...data, lessons: [] };
    rerender(
      <NextLessonBanner
        schedule={updated}
        source="remote"
        loading={false}
        ready
        online
        backendError={false}
      />,
    );
    expect(banner().getByText('Сьогодні пар немає')).toBeTruthy();
    updated.semester = { ...data.semester, id: 'old', startDate: '2025-09-01' };
    rerender(
      <NextLessonBanner
        schedule={{ ...updated }}
        source="remote"
        loading={false}
        ready
        online
        backendError={false}
      />,
    );
    expect(banner().getByText('Семестр завершено')).toBeTruthy();
  });
});
