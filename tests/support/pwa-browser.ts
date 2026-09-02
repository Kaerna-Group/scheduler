import { vi } from 'vitest';
import { createPwaClient } from '@/lib/pwa/client';

export class FakeWorker extends EventTarget {
  state: ServiceWorkerState;
  postMessage = vi.fn();
  constructor(state: ServiceWorkerState = 'installing') {
    super();
    this.state = state;
  }
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

export function pwaBrowser({
  enabled = true,
  secure = true,
  supported = true,
  installed = false,
} = {}) {
  const registration = Object.assign(new EventTarget(), {
    active: null as FakeWorker | null,
    waiting: null as FakeWorker | null,
    installing: null as FakeWorker | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const register = vi.fn().mockResolvedValue(registration);
  const display = Object.assign(new EventTarget(), { matches: installed });
  const win = Object.assign(new EventTarget(), {
    isSecureContext: secure,
    matchMedia: () => display,
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });
  const nav = {
    onLine: true,
    standalone: false,
    ...(supported ? { serviceWorker: { register } } : {}),
  };
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const reload = vi.fn();
  const client = createPwaClient({
    enabled,
    baseUrl: '/scheduler/',
    win: win as unknown as Window,
    nav: nav as unknown as Navigator,
    doc: doc as unknown as Document,
    reload,
  });
  function offerInstall(outcome: 'accepted' | 'dismissed' = 'accepted') {
    const event = Object.assign(
      new Event('beforeinstallprompt', { cancelable: true }),
      {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome }),
      },
    );
    win.dispatchEvent(event);
    return event;
  }
  function offerUpdate() {
    registration.active = new FakeWorker('activated');
    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    registration.waiting = worker;
    worker.change('installed');
    return worker;
  }
  return {
    client,
    registration,
    register,
    display,
    win,
    nav,
    doc,
    reload,
    offerInstall,
    offerUpdate,
  };
}
