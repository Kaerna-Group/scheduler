// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_VERSION,
  ApiError,
  getApi,
  getApiHealth,
  isApiCompatibilityError,
  parseApiResponse,
  postApi,
} from '@/lib/api/client';
import { fetchSchedule, readCachedSchedule } from '@/lib/schedule/repository';
import {
  fetchScheduleHistory,
  readCachedHistory,
} from '@/lib/history/repository';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);

let backend: ReturnType<typeof createTestBackend>;
beforeEach(() => {
  localStorage.clear();
  backend = createTestBackend();
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('versioned API responses', () => {
  it('accepts the current contract and additive fields without mixing in import schemaVersion', () => {
    expect(
      parseApiResponse({
        apiVersion: API_VERSION,
        ok: true,
        data: { schemaVersion: 1 },
        extra: true,
      }),
    ).toEqual({ schemaVersion: 1 });
  });
  it.each([true, false])(
    'identifies an unversioned legacy response (ok=%s)',
    (ok) => {
      expect(() =>
        parseApiResponse({
          ok,
          data: {},
          error: { code: 'UNKNOWN_ACTION', message: 'Old backend' },
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'API_VERSION_MISSING',
          message: expect.stringContaining('too old'),
        }),
      );
    },
  );
  it('explains that a newer backend needs a newer frontend', () => {
    expect(() =>
      parseApiResponse({ apiVersion: API_VERSION + 1, ok: true, data: {} }),
    ).toThrow(
      expect.objectContaining({
        code: 'API_VERSION_MISMATCH',
        message: expect.stringContaining('update the frontend'),
      }),
    );
  });
  it.each([
    null,
    [],
    'html',
    {},
    { apiVersion: 1, ok: true },
    { apiVersion: 1, ok: false },
    { apiVersion: 1, ok: false, error: {} },
  ])('rejects malformed envelopes with a useful error: %j', (value) => {
    expect(() => parseApiResponse(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_API_RESPONSE' }),
    );
  });
  it.each([null, '1', 0, -1, 1.5, true])(
    'requires a positive integer response version: %j',
    (apiVersion) => {
      expect(() =>
        parseApiResponse({ apiVersion, ok: true, data: {} }),
      ).toThrow(expect.objectContaining({ code: 'INVALID_API_RESPONSE' }));
    },
  );
  it('preserves ordinary API errors and revision details', () => {
    try {
      parseApiResponse({
        apiVersion: 1,
        ok: false,
        error: {
          code: 'STALE_DATA',
          message: 'Changed',
          details: { expectedRevision: 9 },
        },
        revision: 9,
      });
      throw new Error('Expected API failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        code: 'STALE_DATA',
        revision: 9,
        details: { expectedRevision: 9 },
      });
      expect(isApiCompatibilityError(error)).toBe(false);
    }
  });
  it('turns an HTML/sign-in response into a readable deployment error, without echoing its content', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html>private response content</html>'),
    );
    await expect(
      getApi({ action: 'schedule', user: 'ermolz' }),
    ).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      message: expect.stringContaining('web-app URL'),
    });
  });
});

describe('compatibility before writes', () => {
  it.each([
    { ok: true, data: {} },
    { apiVersion: 2, ok: true, data: {} },
    { apiVersion: 1, ok: true, data: { apiVersion: 2 } },
    { apiVersion: 1, ok: true, data: null },
  ])(
    'never sends credentials or a mutation to an incompatible backend: %j',
    async (health) => {
      const before = backend.snapshot();
      vi.mocked(fetch).mockResolvedValueOnce(json(health));
      await expect(
        postApi({
          action: 'adminCreateUser',
          editToken: backend.token,
          baseRevision: 1,
          displayName: 'Test',
          slug: 'test',
        }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, options] = vi.mocked(fetch).mock.calls[0];
      expect((input as URL).searchParams.get('action')).toBe('health');
      expect(options?.body).toBeUndefined();
      expect(options?.cache).toBe('no-store');
      expect(backend.snapshot()).toEqual(before);
    },
  );
  it('checks health before every write and does not retain a stale compatibility result', async () => {
    await postApi({
      action: 'adminCreateUser',
      editToken: backend.token,
      baseRevision: 1,
      displayName: 'Test',
      slug: 'test',
    });
    expect(backend.calls.map(({ method, action }) => [method, action])).toEqual(
      [
        ['GET', 'health'],
        ['POST', 'adminCreateUser'],
      ],
    );
    const before = backend.snapshot();
    vi.mocked(fetch).mockResolvedValueOnce(json({ ok: true, data: {} }));
    await expect(
      postApi({
        action: 'adminRotateUserToken',
        editToken: backend.token,
        baseRevision: 2,
        targetUserId: 'U001',
      }),
    ).rejects.toMatchObject({ code: 'API_VERSION_MISSING' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(backend.snapshot()).toEqual(before);
  });
  it('cancels between the health response and the write without sending the mutation', async () => {
    const controller = new AbortController();
    const health = await getApiHealth();
    vi.mocked(fetch)
      .mockClear()
      .mockImplementationOnce(async () => {
        controller.abort();
        return json({ apiVersion: 1, ok: true, data: health });
      });
    await expect(
      postApi({ action: 'undoLastImport' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not check or write for an already cancelled operation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      postApi({ action: 'createSemester' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('versions authenticated read-only POSTs without an extra health round trip', async () => {
    const result = await postApi<{ apiVersion: number }>({
      action: 'adminOverview',
      editToken: backend.token,
      apiVersion: 99,
    });
    expect(result.apiVersion).toBe(API_VERSION);
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]).toMatchObject({
      method: 'POST',
      body: { apiVersion: API_VERSION },
    });
  });
  it('retains schedule and history caches when a later response is incompatible', async () => {
    const schedule = await fetchSchedule('ermolz');
    const history = await fetchScheduleHistory('ermolz', schedule.semester.id);
    vi.mocked(fetch).mockImplementation(async () =>
      json({ ok: true, data: { user: null } }),
    );
    await expect(fetchSchedule('ermolz')).rejects.toMatchObject({
      code: 'API_VERSION_MISSING',
    });
    await expect(
      fetchScheduleHistory('ermolz', schedule.semester.id),
    ).rejects.toMatchObject({ code: 'API_VERSION_MISSING' });
    expect(readCachedSchedule('ermolz', schedule.semester.id)).toEqual(
      schedule,
    );
    expect(readCachedHistory('ermolz', schedule.semester.id)).toEqual(history);
  });
});

describe('Apps Script version contract', () => {
  it('versions health independently from Sheets schema and adds the version to errors', async () => {
    expect(await getApiHealth()).toMatchObject({
      apiVersion: API_VERSION,
      schemaVersion: '2',
      expectedSchemaVersion: '2',
    });
    expect(backend.post({ action: 'adminOverview' })).toMatchObject({
      apiVersion: API_VERSION,
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(backend.post({ action: 'unknown' })).toMatchObject({
      apiVersion: API_VERSION,
      ok: false,
      error: { code: 'UNKNOWN_ACTION' },
    });
  });
  it('allows health negotiation but rejects incompatible GET requests', async () => {
    const health = await backend.fetch(
      'https://scheduler.test/exec?action=health&apiVersion=2',
    );
    expect(await health.json()).toMatchObject({
      apiVersion: 1,
      ok: true,
      data: { apiVersion: 1 },
    });
    const schedule = await backend.fetch(
      'https://scheduler.test/exec?action=schedule&user=ermolz&apiVersion=2',
    );
    expect(await schedule.json()).toMatchObject({
      apiVersion: 1,
      ok: false,
      error: { code: 'API_VERSION_MISMATCH' },
    });
  });
  it.each([2, 0, null, '', '2', {}, true])(
    'rejects unsupported POST versions before any mutation: %j',
    (apiVersion) => {
      const before = backend.snapshot();
      expect(
        backend.post({
          action: 'adminCreateUser',
          editToken: backend.token,
          baseRevision: 1,
          displayName: 'Test',
          slug: 'test',
          apiVersion,
        }),
      ).toMatchObject({
        apiVersion: 1,
        ok: false,
        error: { code: 'API_VERSION_MISMATCH' },
      });
      expect(backend.snapshot()).toEqual(before);
    },
  );
  it('supports original unversioned v1 clients for a backend-first rollout', () => {
    expect(
      backend.post({
        action: 'adminCreateUser',
        editToken: backend.token,
        baseRevision: 1,
        displayName: 'Legacy',
        slug: 'legacy',
      }),
    ).toMatchObject({ apiVersion: 1, ok: true, data: { revision: 2 } });
    expect(backend.snapshot().Users.some((row) => row.slug === 'legacy')).toBe(
      true,
    );
  });
  it.each(['null', '[]', '"string"', '{', ''])(
    'versions malformed JSON errors: %s',
    async (body) => {
      const response = await backend.fetch('https://scheduler.test/exec', {
        method: 'POST',
        body,
      });
      expect(await response.json()).toMatchObject({
        apiVersion: 1,
        ok: false,
        error: { code: 'INVALID_JSON' },
      });
    },
  );
});
