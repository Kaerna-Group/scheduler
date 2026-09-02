// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportGuidePage } from '@/components/schedule/import-guide-page';
import { ChangeHistoryPage } from '@/components/history/change-history-page';
import { exportSchedule } from '@/lib/schedule/import';
import { storeEditToken } from '@/lib/schedule/repository';
import type { UserSchedule } from '@/lib/schedule/types';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() => {
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec');
});
vi.mock('@/hooks/use-preferences', () => ({
  usePreferences: () => ({ hasPendingChanges: false }),
}));
let backend: ReturnType<typeof createTestBackend>;
beforeEach(() => {
  localStorage.clear();
  backend = createTestBackend();
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  localStorage.setItem('scheduler_selected_user_v1', 'ermolz');
  storeEditToken('ermolz', backend.token);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('import diff → shared history → undo', () => {
  it('requires per-course decisions, applies only reviewed shared changes, and restores the previous schedule', async () => {
    const before = backend.snapshot();
    const response = await backend.fetch(
      'https://scheduler.test/exec?action=schedule&user=ermolz',
    );
    const schedule = ((await response.json()) as { data: UserSchedule }).data;
    const payload = exportSchedule(schedule);
    payload.subjects = payload.subjects
      .filter((subject) => subject.lessons?.length)
      .slice(0, 2);
    payload.subjects[0].lessons![0].room = 'QA-APPLIED';
    payload.subjects[1].lessons![0].room = 'QA-KEPT-OUT';
    const page = render(<ImportGuidePage />);
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Refresh data before import',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('Schedule JSON'), {
      target: { value: JSON.stringify(payload) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview diff' }));
    await screen.findByText(/Resolve 2 shared course conflicts/);
    expect(
      (
        screen.getByRole('button', {
          name: 'Apply reviewed import',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(backend.snapshot()).toEqual(before);
    const conflict = (name: string) =>
      within(
        screen.getByRole('heading', { name, level: 5 }).closest('article')!,
      );
    fireEvent.click(
      conflict(payload.subjects[0].name).getByRole('button', {
        name: 'Apply imported',
      }),
    );
    await screen.findByText(/Resolve 1 shared course conflict/);
    fireEvent.click(
      conflict(payload.subjects[1].name).getByRole('button', {
        name: 'Keep stored',
      }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Apply reviewed import',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply reviewed import' }),
    );
    await screen.findByText(/Import completed. Revision/);
    expect(
      backend
        .snapshot()
        .Lessons.some(
          (lesson) => lesson.active === 'yes' && lesson.room === 'QA-APPLIED',
        ),
    ).toBe(true);
    expect(
      backend
        .snapshot()
        .Lessons.some(
          (lesson) => lesson.active === 'yes' && lesson.room === 'QA-KEPT-OUT',
        ),
    ).toBe(false);
    expect(
      backend.calls.filter((call) => call.action === 'importSchedule'),
    ).toHaveLength(1);
    page.unmount();

    render(<ChangeHistoryPage />);
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Undo last import',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.getAllByText(/QA-APPLIED/).length).toBeGreaterThan(0);
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    expect(
      (
        screen.getByRole('button', {
          name: 'Undo last import',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Undo last import',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo last import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    await waitFor(() =>
      expect(
        backend.snapshot().AuditLog.some((row) => row.action === 'UNDO_IMPORT'),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Undo last import',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    expect(backend.snapshot().Lessons).toEqual(before.Lessons);
    expect(backend.snapshot().Enrollments).toEqual(before.Enrollments);
  });
});
