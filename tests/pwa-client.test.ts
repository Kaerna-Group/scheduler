// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeWorker, pwaBrowser } from './support/pwa-browser';

const browsers: ReturnType<typeof pwaBrowser>[] = [];
function setup(options?: Parameters<typeof pwaBrowser>[0]) {
  const result = pwaBrowser(options);
  browsers.push(result);
  return result;
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  browsers.splice(0).forEach(({ client }) => client.stop());
  vi.useRealTimers();
});

describe('PWA browser lifecycle', () => {
  it.each([{ enabled: false }, { secure: false }, { supported: false }])(
    'does not register in an unsupported environment: %j',
    async (options) => {
      const { client, register } = setup(options);
      client.start();
      await client.checkForUpdate();
      expect(register).not.toHaveBeenCalled();
      expect(client.getSnapshot().offline).toBe('unavailable');
    },
  );

  it('registers once under the Pages base, bypassing HTTP caches for updates', async () => {
    const { client, register } = setup();
    client.start();
    client.start();
    await flush();
    expect(register).toHaveBeenCalledExactlyOnceWith('/scheduler/sw.js', {
      scope: '/scheduler/',
      updateViaCache: 'none',
    });
    expect(client.getSnapshot().offline).toBe('preparing');
  });

  it('waits for activation before reporting the first offline download complete', async () => {
    const { client, registration, reload } = setup();
    const worker = new FakeWorker();
    registration.installing = worker;
    client.start();
    await flush();
    worker.change('installed');
    expect(client.getSnapshot().offline).toBe('preparing');
    expect(client.getSnapshot().updateAvailable).toBe(false);
    worker.change('activated');
    expect(client.getSnapshot()).toMatchObject({
      offline: 'ready',
      notice: true,
    });
    client.dismissNotice();
    expect(client.getSnapshot().notice).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('handles a worker already activating when registration resolves', async () => {
    const { client, registration } = setup();
    const worker = new FakeWorker('activating');
    registration.active = worker;
    client.start();
    await flush();
    worker.change('activated');
    expect(client.getSnapshot().offline).toBe('ready');
  });

  it('does not repeat the offline notice on every launch', async () => {
    const { client, registration } = setup();
    registration.active = new FakeWorker('activated');
    client.start();
    await flush();
    expect(client.getSnapshot()).toMatchObject({
      offline: 'ready',
      notice: false,
    });
  });

  it('does not reload or activate a downloaded update until explicitly accepted', async () => {
    const { client, offerUpdate, reload } = setup();
    client.start();
    await flush();
    const worker = offerUpdate();
    expect(client.getSnapshot()).toMatchObject({
      updateAvailable: true,
      notice: true,
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
    client.dismissNotice();
    expect(client.getSnapshot().updateAvailable).toBe(true);
    client.applyUpdate();
    client.applyUpdate();
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'SKIP_WAITING',
    });
    expect(reload).not.toHaveBeenCalled();
    worker.change('activated');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toMatchObject({
      updating: false,
      updateAvailable: false,
    });
  });

  it('detects a waiting update left by an earlier browser session', async () => {
    const { client, registration } = setup();
    registration.active = new FakeWorker('activated');
    registration.waiting = new FakeWorker('installed');
    client.start();
    await flush();
    expect(client.getSnapshot().updateAvailable).toBe(true);
  });

  it('never reloads a tab when another tab activates the update', async () => {
    const { client, offerUpdate, reload } = setup();
    client.start();
    await flush();
    offerUpdate().change('activated');
    expect(reload).not.toHaveBeenCalled();
    expect(client.getSnapshot().updateAvailable).toBe(false);
  });

  it('keeps the app usable and allows retry after an activation timeout', async () => {
    vi.useFakeTimers();
    const { client, offerUpdate, reload } = setup();
    client.start();
    await flush();
    const worker = offerUpdate();
    client.applyUpdate();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(client.getSnapshot()).toMatchObject({
      updating: false,
      updateAvailable: true,
    });
    expect(client.getSnapshot().error).toContain('too long');
    expect(reload).not.toHaveBeenCalled();
    client.applyUpdate();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
  });

  it('reports a failed initial precache, not false offline readiness', async () => {
    const { client, registration } = setup();
    const worker = new FakeWorker();
    registration.installing = worker;
    client.start();
    await flush();
    worker.change('redundant');
    expect(client.getSnapshot().offline).toBe('error');
  });

  it('recovers registration failure when internet returns, without touching schedule storage', async () => {
    const { client, register, registration, win } = setup();
    register.mockRejectedValueOnce(new Error('network'));
    client.start();
    await flush();
    expect(client.getSnapshot().offline).toBe('error');
    registration.active = new FakeWorker('activated');
    win.dispatchEvent(new Event('online'));
    await flush();
    expect(register).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot()).toMatchObject({ offline: 'ready', error: '' });
  });

  it('throttles focus checks, skips hidden/offline checks and retries on reconnection', async () => {
    vi.useFakeTimers();
    const { client, registration, win, nav, doc } = setup();
    client.start();
    await flush();
    win.dispatchEvent(new Event('focus'));
    expect(registration.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    doc.visibilityState = 'hidden';
    win.dispatchEvent(new Event('focus'));
    expect(registration.update).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(registration.update).toHaveBeenCalledTimes(1);
    nav.onLine = false;
    await client.checkForUpdate();
    expect(registration.update).toHaveBeenCalledTimes(1);
    nav.onLine = true;
    win.dispatchEvent(new Event('online'));
    await flush();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('contains update check errors and permits manual retry', async () => {
    const { client, registration } = setup();
    registration.active = new FakeWorker('activated');
    client.start();
    await flush();
    registration.update.mockRejectedValueOnce(new Error('offline'));
    await client.checkForUpdate();
    expect(client.getSnapshot().offline).toBe('ready');
    expect(client.getSnapshot().error).toContain('Could not check');
    await client.checkForUpdate();
    expect(client.getSnapshot().error).toBe('');
  });

  it('captures install availability early, prompts only on click and does not equate acceptance with installation', async () => {
    const { client, offerInstall, win } = setup();
    client.start();
    const event = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    expect(client.getSnapshot().canInstall).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
    await client.install();
    await client.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toMatchObject({
      canInstall: false,
      installed: false,
      installResult: 'accepted',
    });
    win.dispatchEvent(new Event('appinstalled'));
    expect(client.getSnapshot()).toMatchObject({
      canInstall: false,
      installed: true,
    });
  });

  it('consumes a dismissed install event and accepts a fresh browser event', async () => {
    const { client, offerInstall } = setup();
    client.start();
    offerInstall('dismissed');
    await client.install();
    expect(client.getSnapshot()).toMatchObject({
      canInstall: false,
      installResult: 'dismissed',
    });
    offerInstall();
    expect(client.getSnapshot()).toMatchObject({
      canInstall: true,
      installResult: 'idle',
    });
  });

  it('reports native install failures without unhandled promises', async () => {
    const { client, offerInstall } = setup();
    client.start();
    offerInstall().prompt.mockRejectedValueOnce(new Error('not allowed'));
    await client.install();
    expect(client.getSnapshot().installResult).toBe('error');
  });

  it('detects standalone display and its changes', () => {
    const { client, display } = setup({ installed: true });
    client.start();
    expect(client.getSnapshot().installed).toBe(true);
    display.matches = false;
    display.dispatchEvent(new Event('change'));
    expect(client.getSnapshot().installed).toBe(false);
  });

  it('cleans up timers/listeners and ignores late registrations after stop', async () => {
    vi.useFakeTimers();
    const { client, register, registration, win, offerInstall } = setup();
    let resolve!: (value: typeof registration) => void;
    register.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    client.start();
    client.stop();
    resolve(registration);
    await flush();
    offerInstall();
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(register).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
