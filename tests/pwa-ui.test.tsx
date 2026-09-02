// @vitest-environment jsdom
import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaProvider, PwaInstallButton } from '@/components/pwa/pwa-provider';
import { ScheduleActionsMenu } from '@/components/schedule/schedule-actions-menu';
import { AccessGate } from '@/components/access/access-gate';
import { pwaBrowser } from './support/pwa-browser';

const clients: ReturnType<typeof pwaBrowser>[] = [];
async function mount(options?: Parameters<typeof pwaBrowser>[0]) {
  const browser = pwaBrowser(options);
  clients.push(browser);
  browser.client.start();
  render(
    <StrictMode>
      <PwaProvider client={browser.client}>
        <ScheduleActionsMenu />
      </PwaProvider>
    </StrictMode>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return browser;
}
async function openInstall() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Add to home screen' }),
  );
  return screen.findByRole('dialog', { name: 'Add to home screen' });
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(({ client }) => client.stop());
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('PWA installation and update UI', () => {
  it('keeps installation in the compact menu and provides manual installation instructions', async () => {
    await mount();
    expect(screen.queryByText('Add to home screen')).toBeNull();
    const dialog = within(await openInstall());
    expect(dialog.getByText(/Safari/)).toBeTruthy();
    expect(
      dialog.getByText(/Open each personal semester online once/),
    ).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Install app' })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        dialog.getByRole('heading', { name: 'Add to home screen' }),
      ),
    );
  });

  it('offers the native prompt only when available and after a user click', async () => {
    const browser = await mount();
    let event!: ReturnType<typeof browser.offerInstall>;
    act(() => {
      event = browser.offerInstall();
    });
    const dialog = within(await openInstall());
    expect(event.prompt).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Install app' }));
    await waitFor(() =>
      expect(dialog.getByText(/Installation requested/)).toBeTruthy(),
    );
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(dialog.queryByText('My Schedule is installed')).toBeNull();
    act(() => {
      browser.win.dispatchEvent(new Event('appinstalled'));
    });
    expect(
      dialog.getByRole('heading', { name: 'My Schedule is installed' }),
    ).toBeTruthy();
  });

  it('explains a dismissed installation without repeatedly prompting', async () => {
    const browser = await mount();
    act(() => {
      browser.offerInstall('dismissed');
    });
    const dialog = within(await openInstall());
    fireEvent.click(dialog.getByRole('button', { name: 'Install app' }));
    await waitFor(() =>
      expect(dialog.getByText(/Installation canceled/)).toBeTruthy(),
    );
    expect(dialog.queryByRole('button', { name: 'Install app' })).toBeNull();
    expect(dialog.getByText(/Safari/)).toBeTruthy();
  });

  it('shows app information instead of offering to install an already standalone app', async () => {
    await mount({ installed: true });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'App information' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'My Schedule is installed' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });

  it('does not expose production installation controls during development', async () => {
    await mount({ enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.queryByText('Add to home screen')).toBeNull();
  });

  it('does not open a modal or reload on update arrival; Later preserves the pending update', async () => {
    const browser = await mount();
    let worker!: ReturnType<typeof browser.offerUpdate>;
    act(() => {
      worker = browser.offerUpdate();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review update' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Update My Schedule' }),
    );
    expect(dialog.getByText(/close other My Schedule windows/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(browser.reload).not.toHaveBeenCalled();
    expect(browser.client.getSnapshot().updateAvailable).toBe(true);
  });

  it('keeps an update in the menu after dismissing the banner, then requires confirmation', async () => {
    const browser = await mount();
    let worker!: ReturnType<typeof browser.offerUpdate>;
    act(() => {
      worker = browser.offerUpdate();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss app notice' }));
    expect(screen.queryByLabelText('App availability')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Update app' }),
    );
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Update My Schedule' }),
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Update and reload' }));
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(
      dialog
        .getByRole('button', { name: 'Updating…' })
        .hasAttribute('disabled'),
    ).toBe(true);
    act(() => worker.change('activated'));
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it('supports retry when offline setup failed', async () => {
    const browser = pwaBrowser();
    clients.push(browser);
    browser.register.mockRejectedValueOnce(new Error('unavailable'));
    browser.client.start();
    render(
      <PwaProvider client={browser.client}>
        <PwaInstallButton />
      </PwaProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to home screen' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('alert').textContent).toContain(
      'Offline setup is unavailable',
    );
    fireEvent.click(
      dialog.getByRole('button', { name: 'Retry offline setup' }),
    );
    await waitFor(() => expect(browser.register).toHaveBeenCalledTimes(2));
  });

  it('allows installation help before PIN entry but never unlocks protected content', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const browser = pwaBrowser();
    clients.push(browser);
    render(
      <PwaProvider client={browser.client}>
        <AccessGate>
          <h1>Protected schedule</h1>
        </AccessGate>
      </PwaProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to home screen' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('Protected schedule')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
