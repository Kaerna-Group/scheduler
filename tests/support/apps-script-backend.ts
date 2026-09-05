import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { readAppsScriptSource } from '../../scripts/apps-script-sources.mjs';

type Database = Record<string, Array<Record<string, string>>>;
interface BackendFunctions {
  createSeedDatabase_: (token: string) => Database;
  getSchedulerSpreadsheet_: () => { getId: () => string };
  ensureSheet_: (
    spreadsheet: unknown,
    name: string,
    headers: string[],
  ) => unknown;
  setupScheduler: () => unknown;
  upgradeSchedulerSchema: () => unknown;
  schemaTablesNeedingSetup_: (spreadsheet: unknown) => string[];
  readTable_: (name: string) => Database[string];
  writeTable_: (name: string, records: Database[string]) => void;
  buildUserSchedule_: (userSlug: string, semesterId?: string) => unknown;
  doPost: (event: { postData: { contents: string } }) => unknown;
  doGet: (event: { parameter: Record<string, string> }) => unknown;
  setupSchedulerControl: () => unknown;
  createSchedulerIntegration: (id: string, scopes: string[]) => unknown;
  revokeSchedulerIntegration: (id: string) => unknown;
}

interface TestSheet {
  getDisplayHeaders: () => string[];
  getLastRow: () => number;
  getMaxRows: () => number;
  getSheetId: () => number;
  getLastColumn: () => number;
  getDataRange: () => { getDisplayValues: () => string[][] };
}

interface AtomicUpdateCellsRequest {
  range: { sheetId: number };
  rows: Array<{
    values: Array<{ userEnteredValue: { stringValue: string } }>;
  }>;
}

interface AtomicBatchRequest {
  updateCells?: AtomicUpdateCellsRequest;
}

export function createTestScriptCache() {
  let now = 0;
  const entries = new Map<string, { value: string; expiresAt: number }>();
  const failures = { service: false, get: false, put: false };
  const calls: Array<{ operation: 'get' | 'put'; key: string }> = [];
  return {
    entries,
    failures,
    calls,
    advanceSeconds: (seconds: number) => {
      now += seconds * 1000;
    },
    get(key: string) {
      calls.push({ operation: 'get', key });
      if (failures.get) throw new Error('Cache read unavailable');
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= now) return null;
      return entry.value;
    },
    put(key: string, value: string, expiration: number) {
      calls.push({ operation: 'put', key });
      if (failures.put) throw new Error('Cache write unavailable');
      if (key.length > 250 || Buffer.byteLength(value, 'utf8') > 100000)
        throw new Error('Cache entry too large');
      entries.set(key, { value, expiresAt: now + expiration * 1000 });
    },
  };
}

// A real Apps Script backend, isolated entirely in memory. No Google credentials,
// network or production spreadsheet is available to this fixture.
export function createTestBackend(
  options: {
    cache?: ReturnType<typeof createTestScriptCache>;
    spreadsheetId?: string;
    transformSource?: (source: string) => string;
  } = {},
) {
  const source = options.transformSource
    ? options.transformSource(readAppsScriptSource())
    : readAppsScriptSource();
  let locks = 0;
  const cache = options.cache ?? createTestScriptCache();
  const properties = new Map<string, string>();
  let data: Database = {};
  const storage = {
    reads: [] as string[],
    writes: [] as string[],
    events: [] as string[],
    failReadFor: '',
    failWriteFor: '',
    failWriteAfterClearFor: '',
    failWriteAfterStoreFor: '',
    failFlush: false,
    failFlushAt: 0,
    flushCount: 0,
    failPropertySetFor: '',
    failPropertyDeleteFor: '',
    failPropertyAfterSetFor: '',
    propertyEvents: [] as string[],
    batches: [] as unknown[],
    loseBatchResponse: false,
  };
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
      newBlob: (value: string) => ({
        getBytes: () => [...Buffer.from(value, 'utf8')],
      }),
    },
    CacheService: {
      getScriptCache: () => {
        if (cache.failures.service) throw new Error('CacheService unavailable');
        return cache;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties.get(key) ?? null,
        getKeys: () => [...properties.keys()],
        setProperty: (key: string, value: string) => {
          storage.propertyEvents.push('set:' + key);
          if (storage.failPropertySetFor === key)
            throw new Error('Properties quota');
          if (Buffer.byteLength(value, 'utf8') > 9000)
            throw new Error('Property exceeds byte quota');
          properties.set(key, value);
          if (storage.failPropertyAfterSetFor === key)
            throw new Error('Property response lost');
        },
        deleteProperty: (key: string) => {
          storage.propertyEvents.push('delete:' + key);
          if (storage.failPropertyDeleteFor === key)
            throw new Error('Properties delete failed');
          properties.delete(key);
        },
      }),
    },
    SpreadsheetApp: {
      flush() {
        if (locks !== 1) throw new Error('Flush outside LockService');
        storage.events.push('flush');
        storage.flushCount += 1;
        if (storage.failFlush || storage.failFlushAt === storage.flushCount)
          throw new Error('Spreadsheet flush failed');
      },
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (locks) throw new Error('Concurrent write without serialization');
          locks++;
          storage.events.push('lock');
        },
        releaseLock() {
          locks--;
          storage.events.push('unlock');
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
  data = structuredClone(api.createSeedDatabase_(token));
  const tableNames = Object.keys(data);
  const headersByTable = vm.runInContext(
    'Object.assign({}, SCHEDULER_SHEETS, SCHEDULER_CONTROL_SHEETS)',
    context,
  ) as Record<string, string[]>;
  const tableBySheetId = new Map(
    Object.keys(headersByTable).map((name, index) => [index + 1, name]),
  );
  const calls: Array<{
    method: string;
    action: unknown;
    body: Record<string, unknown>;
    response: unknown;
  }> = [];
  // Keep the real database loader and persistence coordinator. Only table I/O
  // is replaced, so tests can measure reads and verify lock/flush ordering.
  api.getSchedulerSpreadsheet_ = () =>
    ({
      getId: () => options.spreadsheetId ?? 'isolated-test-sheet',
      getSheetByName: (name: string) => {
        const sheetId = Object.keys(headersByTable).indexOf(name) + 1;
        if (!sheetId || !data[name]) return null;
        const sheet: TestSheet & {
          getRange: () => { getDisplayValues: () => string[][] };
        } = {
          getDisplayHeaders: () => headersByTable[name] ?? [],
          getLastRow: () => Math.max(1, (data[name]?.length ?? 0) + 1),
          getMaxRows: () => Math.max(1000, (data[name]?.length ?? 0) + 1),
          getSheetId: () => sheetId,
          getLastColumn: () => headersByTable[name].length,
          getDataRange: () => ({
            getDisplayValues: () => [
              headersByTable[name],
              ...data[name].map((row) =>
                headersByTable[name].map((header) => row[header] ?? ''),
              ),
            ],
          }),
          getRange: () => ({
            getDisplayValues: () => [headersByTable[name] ?? []],
          }),
        };
        return sheet;
      },
    }) as unknown as { getId: () => string };
  Object.assign(context, {
    Sheets: {
      Spreadsheets: {
        batchUpdate: ({ requests }: { requests: AtomicBatchRequest[] }) => {
          if (locks !== 1) throw new Error('Write outside LockService');
          storage.batches.push(structuredClone(requests));
          const updates = requests
            .map((request) => request.updateCells)
            .filter(Boolean) as AtomicUpdateCellsRequest[];
          const names = updates.map((update) =>
            tableBySheetId.get(update.range.sheetId),
          );
          const failingName = names.find(
            (name) =>
              name &&
              (storage.failWriteFor === name ||
                storage.failWriteAfterClearFor === name),
          );
          if (failingName) throw new Error('Spreadsheet atomic write failed');

          const next = structuredClone(data);
          updates.forEach((update, index) => {
            const name = names[index];
            if (!name) throw new Error('Unknown test sheet id');
            const headers = headersByTable[name];
            next[name] = update.rows.map((row) =>
              Object.fromEntries(
                headers.map((header, column) => [
                  header,
                  row.values[column]?.userEnteredValue.stringValue ?? '',
                ]),
              ),
            );
          });
          data = next;
          names.forEach((name) => {
            if (!name) return;
            storage.writes.push(name);
            storage.events.push('write:' + name);
          });
          if (names.includes(storage.failWriteAfterStoreFor))
            throw new Error('Spreadsheet atomic write response lost');
          if (storage.loseBatchResponse)
            throw new Error('Batch acknowledgement lost after commit');
        },
      },
    },
  });
  api.ensureSheet_ = (_spreadsheet, name) => {
    if (locks !== 1) throw new Error('Sheet setup outside LockService');
    if (!data[name]) data[name] = [];
  };
  api.schemaTablesNeedingSetup_ = () =>
    tableNames.filter((name) => !data[name]);
  api.readTable_ = (name) => {
    storage.reads.push(name);
    storage.events.push('read:' + name);
    if (storage.failReadFor === name)
      throw new Error('Spreadsheet read failed');
    return structuredClone(data[name] ?? []);
  };
  api.writeTable_ = (name, records) => {
    if (locks !== 1) throw new Error('Write outside LockService');
    storage.writes.push(name);
    storage.events.push('write:' + name);
    if (storage.failWriteFor === name)
      throw new Error('Spreadsheet write failed');
    if (storage.failWriteAfterClearFor === name) {
      data[name] = [];
      throw new Error('Spreadsheet write failed after clearing rows');
    }
    data[name] = structuredClone(records);
    if (storage.failWriteAfterStoreFor === name)
      throw new Error('Spreadsheet write response lost');
  };
  function postRaw(contents: string) {
    const result = api.doPost({ postData: { contents } });
    if (locks) throw new Error('Lock leaked');
    return result;
  }
  function post(body: Record<string, unknown>) {
    return postRaw(JSON.stringify(body));
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
    let body: Record<string, unknown> = Object.fromEntries(url.searchParams);
    if (method === 'POST') {
      body = {};
      // Parse only for the call log. The real API receives the original body,
      // including malformed JSON, and is responsible for validation.
      try {
        const parsed: unknown = JSON.parse(init?.body as string);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          body = parsed as Record<string, unknown>;
      } catch {
        /* Preserve the invalid request for server-side validation. */
      }
    }
    const response =
      method === 'POST'
        ? postRaw(init?.body as string)
        : api.doGet({ parameter: body as Record<string, string> });
    if (locks) throw new Error('Lock leaked');
    calls.push({ method, action: body.action, body, response });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  function checkedMigration(operation: () => unknown) {
    let result: unknown;
    let failure: { error: unknown } | undefined;
    try {
      result = operation();
    } catch (error) {
      failure = { error };
    }
    if (locks) throw new Error('Migration/setup leaked a lock');
    if (failure) throw failure.error;
    return result;
  }
  return {
    token,
    fetch,
    post,
    calls,
    cache,
    storage,
    properties,
    setupControl: () => checkedMigration(() => api.setupSchedulerControl()),
    createIntegration: (id: string, scopes: string[]) =>
      checkedMigration(() => api.createSchedulerIntegration(id, scopes)),
    revokeIntegration: (id: string) =>
      checkedMigration(() => api.revokeSchedulerIntegration(id)),
    setup: () => {
      return checkedMigration(() => api.setupScheduler());
    },
    upgrade: () => {
      return checkedMigration(() => api.upgradeSchedulerSchema());
    },
    // Simulate direct spreadsheet edits/storage faults without any network I/O.
    replaceDatabase: (next: Database) => {
      data = structuredClone(next);
    },
    // Match the JSON wire representation, including omission of undefined fields.
    buildSchedule: (userSlug: string, semesterId?: string): unknown =>
      JSON.parse(JSON.stringify(api.buildUserSchedule_(userSlug, semesterId))),
    snapshot: () => structuredClone(data),
    reset: () => {
      data = structuredClone(api.createSeedDatabase_(token));
      calls.length = 0;
      cache.entries.clear();
      cache.calls.length = 0;
      Object.assign(cache.failures, { service: false, get: false, put: false });
      properties.clear();
      storage.reads.length = 0;
      storage.writes.length = 0;
      storage.events.length = 0;
      storage.failReadFor = '';
      storage.failWriteFor = '';
      storage.failWriteAfterClearFor = '';
      storage.failWriteAfterStoreFor = '';
      storage.failFlush = false;
      storage.failFlushAt = 0;
      storage.flushCount = 0;
      storage.failPropertySetFor = '';
      storage.failPropertyDeleteFor = '';
      storage.failPropertyAfterSetFor = '';
      storage.propertyEvents.length = 0;
      storage.batches.length = 0;
      storage.loseBatchResponse = false;
    },
  };
}
