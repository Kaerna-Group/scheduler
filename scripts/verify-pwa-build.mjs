import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Run against the actual generated worker, not a hand-maintained copy of its manifest.
const root = new URL('../dist/', import.meta.url);
const read = (name) => readFile(new URL(name, root));
const html = (await read('index.html')).toString();
const sw = (await read('sw.js')).toString();
const manifest = JSON.parse((await read('manifest.webmanifest')).toString());
const origin = 'https://pwa-build-check.example';
const scope = `${origin}/scheduler/`;
assert.equal(manifest.scope, '/scheduler/');
assert.equal(manifest.id, '/scheduler/');
assert.equal(manifest.start_url, '/scheduler/#/');
assert.equal(manifest.display, 'standalone');
assert.match(html, /rel="manifest" href="\/scheduler\/manifest\.webmanifest"/);
assert.match(html, /rel="apple-touch-icon"/);
assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
for (const icon of [
  ...manifest.icons,
  { src: 'icons/apple-touch-icon.png', sizes: '180x180' },
]) {
  const png = await read(icon.src);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
}
const entries = [
  ...sw.matchAll(/\{url:"([^"]+)",revision:(null|"[^"]+")\}/g),
].map(([, url, revision]) => ({ url, revision: JSON.parse(revision) }));
assert.ok(entries.length > 8, 'Generated precache manifest not found');
assert.equal(
  new Set(entries.map(({ url }) => url)).size,
  entries.length,
  'Duplicate precache entries',
);
const assets = (await readdir(new URL('assets/', root)))
  .filter((name) => /\.(js|css)$/.test(name))
  .map((name) => `assets/${name}`);
assert.ok(
  assets.some((name) => name.includes('admin-page-')),
  'Lazy admin chunk must also work offline',
);
const expected = [
  'index.html',
  'storage-migrations.js',
  'theme-init.js',
  'manifest.webmanifest',
  'favicon.svg',
  ...assets,
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];
assert.deepEqual(
  entries.map(({ url }) => url).sort(),
  expected.sort(),
  'Cache only the complete public shell',
);
const bodies = new Map();
for (const { url, revision } of entries) {
  const body = await read(url);
  bodies.set(new URL(url, scope).href, body);
  if (revision)
    assert.equal(
      revision,
      createHash('md5').update(body).digest('hex'),
      `Stale revision: ${url}`,
    );
  else
    assert.match(
      url,
      /^assets\/.+-[^/]+\.(js|css)$/,
      'Unversioned static asset',
    );
}

// Minimal browser boundary. Workbox's real install/fetch/activate handlers run in the VM.
class BrowserRequest extends Request {
  constructor(input, options) {
    super(typeof input === 'string' ? new URL(input, scope) : input, options);
  }
}
class WorkerEvent {
  constructor(type) {
    this.type = type;
    this.promises = [];
  }
  waitUntil(promise) {
    this.promises.push(promise);
  }
  async finish() {
    while (this.promises.length) await Promise.all(this.promises.splice(0));
  }
}
class WorkerFetchEvent extends WorkerEvent {
  constructor(request) {
    super('fetch');
    this.request = request;
  }
  respondWith(response) {
    this.response = Promise.resolve(response);
  }
}
function cacheStorage() {
  const stores = new Map();
  const key = (input) => (typeof input === 'string' ? input : input.url);
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async (request) => entries.get(key(request))?.clone(),
        put: async (request, response) => {
          entries.set(key(request), response.clone());
        },
        keys: async () =>
          [...entries.keys()].map((url) => new BrowserRequest(url)),
        delete: async (request) => entries.delete(key(request)),
      };
    },
    async match(request, options) {
      return (await this.open(options.cacheName)).match(request);
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
}
function worker(cache = cacheStorage(), failedAsset = '', source = sw) {
  const handlers = new Map();
  let online = true;
  let skipped = 0;
  let claimed = 0;
  const requests = [];
  const self = {
    location: new URL('sw.js', scope),
    registration: { scope },
    caches: cache,
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
    },
    skipWaiting() {
      skipped++;
    },
    clients: {
      claim() {
        claimed++;
      },
    },
  };
  vm.runInNewContext(source, {
    self,
    registration: self.registration,
    location: self.location,
    caches: cache,
    URL,
    Request: BrowserRequest,
    Response,
    Headers,
    FetchEvent: WorkerFetchEvent,
    setTimeout,
    console,
    fetch: async (request) => {
      requests.push(request.url);
      assert.ok(
        bodies.has(request.url),
        `Unexpected network request: ${request.url}`,
      );
      if (!online || request.url.endsWith(failedAsset || '__not_an_asset__'))
        throw new Error('offline');
      return new Response(bodies.get(request.url));
    },
  });
  async function dispatch(event) {
    for (const handler of handlers.get(event.type) || []) handler(event);
    const response = event.response && (await event.response);
    await event.finish();
    return response;
  }
  async function request(path, mode = 'navigate', method = 'GET') {
    const request = new BrowserRequest(path, { method });
    Object.defineProperty(request, 'mode', { value: mode });
    return dispatch(new WorkerFetchEvent(request));
  }
  return {
    cache,
    dispatch,
    request,
    requests,
    offline() {
      online = false;
    },
    skipped: () => skipped,
    claimed: () => claimed,
  };
}
const app = worker();
await app.dispatch(new WorkerEvent('install'));
assert.equal(app.requests.length, entries.length);
assert.equal(app.skipped(), 0, 'Installation must not force an update');
const ownCacheName = (await app.cache.keys())[0];
assert.ok(ownCacheName.startsWith('my-schedule-shell-'));
const ownCache = await app.cache.open(ownCacheName);
await ownCache.put(`${scope}obsolete.js`, new Response('old chunk'));
const otherCache = await app.cache.open('another-app-precache');
await otherCache.put(
  `${origin}/another-app/index.html`,
  new Response('unrelated app'),
);
await app.dispatch(new WorkerEvent('activate'));
assert.equal(app.claimed(), 0, 'Do not take over other open tabs');
assert.equal(await ownCache.match(`${scope}obsolete.js`), undefined);
assert.ok(
  await otherCache.match(`${origin}/another-app/index.html`),
  'Keep unrelated caches',
);
app.offline();
const fetched = app.requests.length;
for (const path of [
  '/scheduler/',
  '/scheduler/index.html',
  '/scheduler/?offline=1#/week/5?user=demo&subject=Scrum',
]) {
  assert.equal(
    await (await app.request(path)).text(),
    html,
    `Offline navigation: ${path}`,
  );
}
for (const asset of assets) {
  assert.equal(
    await (await app.request(`/scheduler/${asset}`, 'cors')).text(),
    bodies.get(`${scope}${asset}`).toString(),
  );
}
for (const [path, mode, method] of [
  ['https://script.google.com/macros/s/example/exec?user=demo', 'cors', 'GET'],
  ['https://script.google.com/macros/s/example/exec', 'cors', 'POST'],
  ['/scheduler/api?token=test-only', 'cors', 'GET'],
  ['/scheduler/', 'navigate', 'POST'],
  ['/another-app/', 'navigate', 'GET'],
  ['/scheduler/missing-page', 'navigate', 'GET'],
])
  assert.equal(
    await app.request(path, mode, method),
    undefined,
    `Must bypass service worker: ${method} ${path}`,
  );
assert.equal(
  app.requests.length,
  fetched,
  'Offline shell must not require network',
);
const message = new WorkerEvent('message');
message.data = { type: 'SKIP_WAITING' };
await app.dispatch(message);
assert.equal(app.skipped(), 1, 'Activate only after confirmation');

const failed = worker(cacheStorage(), assets[0]);
await assert.rejects(failed.dispatch(new WorkerEvent('install')), /offline/);
assert.equal(failed.skipped(), 0, 'A partial download must not activate');

// A failed *update* must leave the current shell usable, not just reject a cold install.
const nextWorkerSource = sw.replace(
  /url:"index\.html",revision:"[^"]+"/,
  'url:"index.html",revision:"next-release-fixture"',
);
assert.notEqual(nextWorkerSource, sw);
const failedUpdate = worker(app.cache, 'index.html', nextWorkerSource);
await assert.rejects(
  failedUpdate.dispatch(new WorkerEvent('install')),
  /offline/,
);
assert.equal(failedUpdate.skipped(), 0);
assert.equal(
  await (await app.request('/scheduler/?after-failed-update=1')).text(),
  html,
);
assert.equal(
  app.requests.length,
  fetched,
  'Old shell survives a failed update without network',
);
console.log(
  `PWA verified: ${entries.length} versioned public assets, icons, offline hash routes, lazy chunks, network bypass, safe activation and failed installation.`,
);
