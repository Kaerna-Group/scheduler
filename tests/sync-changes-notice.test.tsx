// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncChangesNotice } from '@/components/schedule/sync-changes-notice';
import { compareScheduleSync } from '@/lib/schedule/sync-diff';
import { fallbackSchedule } from '@/data/fallback-schedule';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function comparison(room = '2-202') {
  const before = structuredClone(fallbackSchedule);
  const after = structuredClone(before);
  after.lessons[0].room = room;
  after.lessons[0].weeks = [4, 5, 6, 7];
  return compareScheduleSync(
    before,
    after,
    '2026-09-02T09:00:00Z',
    '2026-09-02T10:00:00Z',
  )!;
}
async function open() {
  fireEvent.click(
    screen.getByRole('button', { name: '1 class changed View changes' }),
  );
  return screen.findByRole('dialog', { name: 'Changes since last sync' });
}
describe('read-only sync diff dialog', () => {
  it('is opt-in, shows exact before/after values and explains net changes', async () => {
    render(<SyncChangesNotice comparison={comparison()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await open();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole('heading', {
          name: 'Changes since last sync',
        }),
      ),
    );
    expect(within(dialog).getByText('4–12')).toBeTruthy();
    expect(within(dialog).getByText('4–7')).toBeTruthy();
    expect(within(dialog).getByText('1-001')).toBeTruthy();
    expect(within(dialog).getByText('2-202')).toBeTruthy();
    expect(
      within(dialog).getByText(/net difference between two syncs/),
    ).toBeTruthy();
    expect(
      within(dialog)
        .getByRole('link', { name: 'Full change history' })
        .getAttribute('href'),
    ).toBe('#/changes');
    expect(
      within(dialog).queryByRole('button', { name: /Apply|Undo/ }),
    ).toBeNull();
  });

  it('closes with Escape and returns focus to the notice', async () => {
    render(<SyncChangesNotice comparison={comparison()} onDismiss={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /View changes/ });
    trigger.focus();
    const dialog = await open();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes an old open comparison if another refresh replaces it', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <SyncChangesNotice comparison={comparison()} onDismiss={onDismiss} />,
    );
    await open();
    rerender(
      <SyncChangesNotice
        comparison={comparison('3-303')}
        onDismiss={onDismiss}
      />,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const dialog = await open();
    expect(within(dialog).getByText('3-303')).toBeTruthy();
    expect(within(dialog).queryByText('2-202')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses only on explicit acknowledgement and handles unavailable timestamps', async () => {
    const onDismiss = vi.fn();
    const diff = { ...comparison(), previousSync: '', syncedAt: 'invalid' };
    render(<SyncChangesNotice comparison={diff} onDismiss={onDismiss} />);
    const dialog = await open();
    expect(
      within(dialog).getByText('Previous sync: Time unavailable'),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('Current sync: Time unavailable'),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Dismiss notice' }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders malicious-looking sheet text as text, never executable markup', async () => {
    const diff = comparison('<img src=x onerror=alert(1)>');
    render(<SyncChangesNotice comparison={diff} onDismiss={vi.fn()} />);
    const dialog = await open();
    expect(
      within(dialog).getByText('<img src=x onerror=alert(1)>'),
    ).toBeTruthy();
    expect(dialog.querySelector('img')).toBeNull();
    expect(dialog.querySelector('script')).toBeNull();
  });
});
