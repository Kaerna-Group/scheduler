// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LessonParticipants } from '@/components/schedule/lesson-participants';
import type { LessonParticipants as Participants } from '@/lib/schedule/participants';

const owner = {
  id: 'U1',
  slug: 'owner',
  displayName: 'Owner User',
  role: 'user' as const,
};
const second = {
  id: 'U2',
  slug: 'second',
  displayName: 'Second User',
  role: 'user' as const,
};
afterEach(cleanup);

function open(participants: Participants) {
  render(<LessonParticipants participants={participants} ownerId={owner.id} />);
  const button = screen.getByRole('button');
  expect(button.parentElement?.className).toContain('absolute');
  expect(button.parentElement?.className).not.toContain('mt-3');
  fireEvent.click(button);
  return button;
}

describe('participant status UI', () => {
  it('shows unavailable and checking states even when avatars are hidden', () => {
    let button = open({
      users: [],
      state: 'unavailable',
      checked: 0,
      total: 7,
    });
    expect(button.getAttribute('aria-label')).toBe(
      'Participant check unavailable',
    );
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(
      screen.getByText(/Refresh after the backend is updated/),
    ).toBeTruthy();
    cleanup();
    button = open({ users: [], state: 'checking', checked: 0, total: 7 });
    expect(button.getAttribute('aria-label')).toBe('Checking participants');
    expect(screen.getByText('Checking')).toBeTruthy();
    expect(screen.getByText('Checking participants…')).toBeTruthy();
  });

  it('lists shared users and exposes the completed coverage separately', () => {
    const button = open({
      users: [owner, second],
      state: 'complete',
      checked: 7,
      total: 7,
    });
    expect(button.getAttribute('aria-label')).toBe(
      '2 people attending; participant check complete',
    );
    expect(screen.getByText('Checked')).toBeTruthy();
    expect(screen.getByText('Owner User')).toBeTruthy();
    expect(screen.getByText('Second User')).toBeTruthy();
    expect(
      screen.getByText('2 attendees found · 7 schedule profiles checked.'),
    ).toBeTruthy();
  });

  it('does not present checked profiles as attendee count', () => {
    const button = open({
      users: [owner],
      state: 'complete',
      checked: 3,
      total: 3,
    });
    expect(button.getAttribute('aria-label')).toBe(
      'No other attendees; participant check complete',
    );
    expect(screen.getByText('Only you')).toBeTruthy();
    expect(screen.queryByText('3/3')).toBeNull();
    expect(
      screen.getByText(
        'Check complete · no other attendees found. 3 schedule profiles checked.',
      ),
    ).toBeTruthy();
  });

  it('shows a saved-data status with one known attendee', () => {
    const button = open({
      users: [owner],
      state: 'stale',
      checked: 7,
      total: 7,
    });
    expect(button.getAttribute('aria-label')).toContain(
      'saved participant data',
    );
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(
      screen.getByText('Saved data · 7 of 7 users were checked.'),
    ).toBeTruthy();
  });
});
