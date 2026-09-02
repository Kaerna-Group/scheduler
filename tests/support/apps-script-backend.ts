import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';

type Database = Record<string, Array<Record<string, string>>>;
interface BackendFunctions {
  createSeedDatabase_: (token: string) => Database;
  loadDatabase_: () => Database;
  persistDatabase_: (data: Database, tables: string[]) => void;
  doPost: (event: { postData: { contents: string } }) => unknown;
  doGet: (event: { parameter: Record<string, string> }) => unknown;
}

// A real Apps Script backend, isolated entirely in memory. No Google credentials,
// network or production spreadsheet is available to this fixture.
export function createTestBackend() {
  const directory = join(process.cwd(), 'apps-script');
  const source = readdirSync(directory)
    .filter((name) => /^\d+_.*\.gs$/.test(name))
    .sort()
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n');
  let locks = 0;
  const context = vm.createContext({
    console: { error() {} },
    Utilities: {
      getUuid: randomUUID,
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm: string, value: string) => [
        ...createHash(algorithm).update(value).digest(),
      ],
      base64EncodeWebSafe: (bytes: number[]) =>
        Buffer.from(bytes).toString('base64url'),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (locks) throw new Error('Concurrent write without serialization');
          locks++;
        },
        releaseLock() {
          locks--;
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({
        setMimeType: () => JSON.parse(text) as unknown,
      }),
    },
  });
  vm.runInContext(source, context);
  const api = context as unknown as BackendFunctions;
  const token = 'isolated-test-admin-credential-never-valid-in-production';
  let data = structuredClone(api.createSeedDatabase_(token));
  const calls: Array<{
    method: string;
    action: unknown;
    body: Record<string, unknown>;
    response: unknown;
  }> = [];
  api.loadDatabase_ = () => structuredClone(data);
  api.persistDatabase_ = (next, tables) => {
    if (locks !== 1) throw new Error('Write outside LockService');
    tables.forEach((name) => {
      data[name] = structuredClone(next[name]);
    });
  };
  function post(body: Record<string, unknown>) {
    const result = api.doPost({ postData: { contents: JSON.stringify(body) } });
    if (locks) throw new Error('Lock leaked');
    return result;
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.origin !== 'https://scheduler.test')
      throw new Error('Test blocked an unexpected network destination');
    const method = init?.method ?? 'GET';
    if (method === 'POST' && typeof init?.body !== 'string')
      throw new Error('The test backend only accepts JSON request bodies');
    const body =
      method === 'POST'
        ? (JSON.parse(init?.body as string) as Record<string, unknown>)
        : Object.fromEntries(url.searchParams);
    const response =
      method === 'POST'
        ? post(body)
        : api.doGet({ parameter: body as Record<string, string> });
    calls.push({ method, action: body.action, body, response });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return {
    token,
    fetch,
    post,
    calls,
    snapshot: () => structuredClone(data),
    reset: () => {
      data = structuredClone(api.createSeedDatabase_(token));
      calls.length = 0;
    },
  };
}
