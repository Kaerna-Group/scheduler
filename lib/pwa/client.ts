interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  enabled: boolean;
  installed: boolean;
  canInstall: boolean;
  installResult: 'idle' | 'prompting' | 'accepted' | 'dismissed' | 'error';
  offline: 'preparing' | 'ready' | 'unavailable' | 'error';
  updateAvailable: boolean;
  updating: boolean;
  notice: boolean;
  error: string;
}

export interface PwaClient {
  getSnapshot: () => PwaState;
  subscribe: (listener: () => void) => () => void;
  start: () => void;
  stop: () => void;
  install: () => Promise<void>;
  applyUpdate: () => void;
  checkForUpdate: () => Promise<void>;
  dismissNotice: () => void;
}

// Kept outside React so install events cannot be lost during mounting/StrictMode.
// This controller never reads user data or writes to any browser storage.
export function createPwaClient({
  enabled,
  baseUrl,
  win = window,
  nav = navigator,
  doc = document,
  reload = () => win.location.reload(),
}: {
  enabled: boolean;
  baseUrl: string;
  win?: Window;
  nav?: Navigator;
  doc?: Document;
  reload?: () => void;
}): PwaClient {
  const display = win.matchMedia?.('(display-mode: standalone)');
  const standalone = () =>
    Boolean(
      display?.matches ||
      (nav as Navigator & { standalone?: boolean }).standalone,
    );
  const supported = enabled && win.isSecureContext && 'serviceWorker' in nav;
  let state: PwaState = {
    enabled,
    installed: standalone(),
    canInstall: false,
    installResult: 'idle',
    offline: supported ? 'preparing' : 'unavailable',
    updateAvailable: false,
    updating: false,
    notice: false,
    error: '',
  };
  const listeners = new Set<() => void>();
  let running = false;
  let generation = 0;
  let prompt: InstallPromptEvent | null = null;
  let registration: ServiceWorkerRegistration | null = null;
  let registering = false;
  let checking = false;
  let waiting: ServiceWorker | null = null;
  let lastCheck = 0;
  let activationTimer: number | undefined;
  let interval: number | undefined;
  const cleanup: Array<() => void> = [];
  const watched = new Set<ServiceWorker>();

  function set(patch: Partial<PwaState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function listen(target: EventTarget, event: string, handler: () => void) {
    target.addEventListener(event, handler);
    cleanup.push(() => target.removeEventListener(event, handler));
  }

  function watch(worker: ServiceWorker) {
    if (watched.has(worker)) return;
    watched.add(worker);
    const changed = () => {
      if (!running) return;
      if (worker.state === 'installed' && registration?.active) {
        waiting = worker;
        set({ updateAvailable: true, notice: true, error: '' });
      } else if (worker.state === 'activated') {
        const accepted = state.updating && waiting === worker;
        const firstInstall = state.offline !== 'ready';
        if (waiting === worker) waiting = null;
        win.clearTimeout(activationTimer);
        set({
          offline: 'ready',
          updateAvailable: false,
          updating: false,
          notice: firstInstall,
          error: '',
        });
        // Only this tab's explicit confirmation can reload it. Other tabs keep drafts.
        if (accepted) reload();
      } else if (
        worker.state === 'redundant' &&
        (waiting === worker || state.offline !== 'ready')
      ) {
        waiting = null;
        win.clearTimeout(activationTimer);
        set({
          offline: registration?.active ? 'ready' : 'error',
          updating: false,
          updateAvailable: false,
          error:
            'The app could not finish downloading. Connect to the internet and retry.',
        });
      }
    };
    listen(worker, 'statechange', changed);
    changed();
  }

  async function register() {
    if (!running || !supported || registering || registration) return;
    registering = true;
    const requestGeneration = generation;
    try {
      const result = await nav.serviceWorker.register(`${baseUrl}sw.js`, {
        scope: baseUrl,
        updateViaCache: 'none',
      });
      if (!running || generation !== requestGeneration) return;
      registration = result;
      if (result.active?.state === 'activated')
        set({ offline: 'ready', error: '' });
      listen(result, 'updatefound', () => {
        if (result.installing) watch(result.installing);
      });
      if (result.waiting) watch(result.waiting);
      if (result.installing) watch(result.installing);
      if (result.active && result.active.state !== 'activated')
        watch(result.active);
      lastCheck = Date.now();
    } catch {
      if (running && generation === requestGeneration) {
        set({
          offline: 'error',
          error:
            'Offline setup is unavailable. Connect to the internet and retry.',
        });
      }
    } finally {
      if (generation === requestGeneration) registering = false;
    }
  }

  async function checkForUpdate() {
    if (!running || !supported || !nav.onLine || checking) return;
    if (!registration) return register();
    checking = true;
    const requestGeneration = generation;
    try {
      await registration.update();
      if (running && requestGeneration === generation) set({ error: '' });
    } catch {
      if (running && requestGeneration === generation) {
        set({
          error:
            'Could not check for an app update. Your saved schedule is still available.',
        });
      }
    } finally {
      if (requestGeneration === generation) checking = false;
    }
  }

  function resume() {
    if (doc.visibilityState === 'hidden' || Date.now() - lastCheck < 60_000)
      return;
    lastCheck = Date.now();
    void checkForUpdate();
  }

  const capturePrompt = (event: Event) => {
    if (!('prompt' in event) || !('userChoice' in event)) return;
    event.preventDefault();
    prompt = event as InstallPromptEvent;
    set({ canInstall: !state.installed, installResult: 'idle' });
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (running || !enabled) return;
      running = true;
      generation++;
      win.addEventListener('beforeinstallprompt', capturePrompt);
      cleanup.push(() =>
        win.removeEventListener('beforeinstallprompt', capturePrompt),
      );
      listen(win, 'appinstalled', () => {
        prompt = null;
        set({ installed: true, canInstall: false, installResult: 'idle' });
      });
      if (display)
        listen(display, 'change', () =>
          set({
            installed: standalone(),
            canInstall: !standalone() && Boolean(prompt),
          }),
        );
      if (supported) {
        listen(win, 'online', () => {
          void checkForUpdate();
        });
        listen(win, 'focus', resume);
        listen(doc, 'visibilitychange', resume);
        interval = win.setInterval(resume, 60 * 60_000);
        void register();
      }
    },
    stop() {
      running = false;
      generation++;
      cleanup.splice(0).forEach((remove) => remove());
      win.clearInterval(interval);
      win.clearTimeout(activationTimer);
      watched.clear();
      registration = null;
      waiting = null;
      prompt = null;
      registering = false;
      checking = false;
    },
    async install() {
      if (
        !running ||
        !prompt ||
        state.installed ||
        state.installResult === 'prompting'
      )
        return;
      const event = prompt;
      const requestGeneration = generation;
      prompt = null; // A browser install event is single-use, including dismissals.
      set({ canInstall: false, installResult: 'prompting' });
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (running && generation === requestGeneration && !state.installed)
          set({ installResult: outcome });
      } catch {
        if (running && generation === requestGeneration && !state.installed)
          set({ installResult: 'error' });
      }
    },
    applyUpdate() {
      if (!waiting || state.updating || !running) return;
      set({ updating: true, error: '' });
      try {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        activationTimer = win.setTimeout(() => {
          if (state.updating)
            set({
              updating: false,
              error:
                'The update is taking too long. Retry or reopen the app after saving your changes.',
            });
        }, 15_000);
      } catch {
        set({
          updating: false,
          error:
            'Could not activate the update. Save your changes and reopen the app.',
        });
      }
    },
    checkForUpdate,
    dismissNotice: () => set({ notice: false }),
  };
}
