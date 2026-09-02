// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getApiHealth } from '@/lib/api/client';
import {
  createAdminUser,
  setAdminUserActive,
  updateAdminUser,
} from '@/lib/admin/repository';
import { undoLastImport } from '@/lib/history/repository';
import { updatePreferences } from '@/lib/preferences/repository';
import { createSemester, archiveSemester } from '@/lib/semesters/repository';
import { exportSchedule } from '@/lib/schedule/import';
import {
  fetchSchedule,
  importPersonalSchedule,
  updateEnrollments,
} from '@/lib/schedule/repository';
import type { UserSchedule } from '@/lib/schedule/types';
import { createTestBackend } from './support/apps-script-backend';
import { assertContract } from './support/typescript-contract';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);
const metadataTables = ['Meta', 'Users', 'Semesters', 'UserPreferences'];
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

async function schedule(slug = 'ermolz', semesterId?: string) {
  const dto = await fetchSchedule(slug, semesterId);
  assertContract('UserSchedule', dto);
  return dto;
}
function resetReads() {
  backend.storage.reads.length = 0;
  backend.storage.events.length = 0;
}
function expectColdRead() {
  expect([...backend.storage.reads].sort((a, b) => a.localeCompare(b))).toEqual(
    Object.keys(backend.snapshot()).sort((a, b) => a.localeCompare(b)),
  );
}
function expectWarmRead() {
  expect(backend.storage.reads).toEqual(metadataTables);
  expect(backend.storage.events).toEqual([
    'lock',
    ...metadataTables.map((name) => 'read:' + name),
    'unlock',
  ]);
}
function currentKey() {
  return backend.cache.calls.at(-1)!.key;
}
async function createMember(revision: number) {
  return createAdminUser(backend.token, revision, {
    displayName: 'Member',
    slug: 'cache-member',
    role: 'user',
  });
}
function newSubjectImport(dto: UserSchedule) {
  const payload = exportSchedule(dto);
  payload.subjects = [
    { externalCode: 'CACHE-101', name: 'Cache test subject', lessons: [] },
  ];
  return {
    userSlug: dto.user.slug,
    token: backend.token,
    schedule: payload,
    mode: 'merge' as const,
    baseRevision: dto.revision,
  };
}

describe('Apps Script schedule cache read path', () => {
  it('reads twelve tables on a miss, four on a hit, and reuses explicit/default semester keys', async () => {
    const before = backend.snapshot();
    const cold = await schedule();
    expectColdRead();
    expect(backend.cache.entries.size).toBe(1);
    expect(currentKey()).toContain(
      `:ermolz:${cold.semester.id}:${cold.revision}:settings:0`,
    );
    resetReads();
    const warm = await schedule('ermolz', cold.semester.id);
    expectWarmRead();
    expect(warm).toEqual(cold);
    expect(backend.cache.entries.size).toBe(1);
    expect(backend.snapshot()).toEqual(before);
    expect(backend.storage.writes).toEqual([]);
    expect(backend.properties.size).toBe(0);
    expect(JSON.stringify([...backend.cache.entries.values()])).not.toMatch(
      /edit_token_hash|editToken/,
    );
    expect(JSON.stringify([...backend.cache.entries.values()])).not.toContain(
      backend.token,
    );
  });

  it('isolates users and never reads a token from the cached DTO', async () => {
    const initial = await schedule();
    const member = await createMember(initial.revision);
    const owner = await schedule();
    const ownerKey = currentKey();
    const other = await schedule(member.user.slug);
    expect(currentKey()).not.toBe(ownerKey);
    expect(owner.user.id).not.toBe(other.user.id);
    expect(other.subjects).toEqual([]);
    resetReads();
    expect(await schedule()).toEqual(owner);
    expectWarmRead();
    resetReads();
    expect(await schedule(member.user.slug)).toEqual(other);
    expectWarmRead();
    expect(JSON.stringify([...backend.cache.entries.values()])).not.toContain(
      member.editToken,
    );
  });

  it('isolates identical revisions and data in different spreadsheets sharing one script cache', async () => {
    await schedule();
    const firstKey = currentKey();
    const second = createTestBackend({
      cache: backend.cache,
      spreadsheetId: 'another-test-sheet',
    });
    second.replaceDatabase(backend.snapshot());
    vi.stubGlobal('fetch', second.fetch);
    await schedule();
    expect(second.cache.calls.at(-1)?.key).not.toBe(firstKey);
    expect(second.storage.reads).toHaveLength(
      Object.keys(second.snapshot()).length,
    );
    expect(second.cache.entries.size).toBe(2);
  });

  it.each(['expiry', 'early eviction'] as const)(
    'rebuilds after %s with the same DTO',
    async (reason) => {
      const cold = await schedule();
      if (reason === 'expiry') backend.cache.advanceSeconds(301);
      else backend.cache.entries.clear();
      resetReads();
      expect(await schedule()).toEqual(cold);
      expectColdRead();
      resetReads();
      expect(await schedule()).toEqual(cold);
      expectWarmRead();
    },
  );

  it.each(['service', 'get', 'put'] as const)(
    'falls back to real Sheets reads when cache %s fails',
    async (method) => {
      backend.cache.failures[method] = true;
      const first = await schedule();
      expectColdRead();
      resetReads();
      expect(await schedule()).toEqual(first);
      expectColdRead();
      backend.cache.failures[method] = false;
      await schedule();
      resetReads();
      expect(await schedule()).toEqual(first);
      expectWarmRead();
    },
  );

  it.each(['{broken', 'null', '{}', '{"payload":"{}","checksum":"wrong"}'])(
    'repairs an unreadable cache entry: %s',
    async (value) => {
      const original = await schedule();
      backend.cache.entries.get(currentKey())!.value = value;
      resetReads();
      expect(await schedule()).toEqual(original);
      expectColdRead();
      resetReads();
      await schedule();
      expectWarmRead();
    },
  );

  it.each([
    'checksum',
    'user',
    'semester',
    'revision',
    'preferencesRevision',
    'key',
  ] as const)('rejects cached data with incorrect %s', async (part) => {
    const original = await schedule();
    const key = currentKey();
    const entry = backend.cache.entries.get(key)!;
    const dto = structuredClone(original);
    if (part === 'user') dto.user.id = 'another-user';
    if (part === 'semester') dto.semester.id = 'another-semester';
    if (part === 'revision') dto.revision++;
    if (part === 'preferencesRevision') dto.preferencesRevision!++;
    const payload = JSON.stringify(dto);
    entry.value = JSON.stringify({
      key: part === 'key' ? 'another-key' : key,
      payload,
      checksum:
        part === 'checksum'
          ? 'damaged'
          : createHash('sha256').update(payload).digest('base64url'),
    });
    resetReads();
    expect(await schedule()).toEqual(original);
    expectColdRead();
  });

  it('skips oversized UTF-8 entries without truncating the schedule', async () => {
    const data = backend.snapshot();
    data.Lessons[0].teacher = 'Я'.repeat(60000);
    backend.replaceDatabase(data);
    const dto = await schedule();
    expect(dto.lessons.some((lesson) => lesson.teacher.length === 60000)).toBe(
      true,
    );
    expect(JSON.stringify(dto).length).toBeLessThan(90000);
    expect(Buffer.byteLength(JSON.stringify(dto), 'utf8')).toBeGreaterThan(
      100000,
    );
    expect(backend.cache.entries.size).toBe(0);
    expect(backend.cache.calls.some((call) => call.operation === 'put')).toBe(
      false,
    );
    resetReads();
    expect((await schedule()).lessons[0].teacher).toBe(dto.lessons[0].teacher);
    expectColdRead();
  });

  it('keeps cache keys bounded even for long legacy identifiers', async () => {
    const data = backend.snapshot();
    data.Users[0].slug = 'long-legacy-slug-'.repeat(40);
    backend.replaceDatabase(data);
    const dto = await schedule(data.Users[0].slug);
    expect(currentKey().length).toBeLessThanOrEqual(250);
    expect(backend.cache.entries.size).toBe(1);
    resetReads();
    expect(await schedule(data.Users[0].slug)).toEqual(dto);
    expectWarmRead();
  });

  it('does not hide a spreadsheet outage behind a warm cache', async () => {
    const original = await schedule();
    backend.storage.failReadFor = 'Meta';
    await expect(schedule()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(backend.storage.events.at(-1)).toBe('read:Meta'); // error envelope also attempts to read revision
    backend.storage.failReadFor = '';
    resetReads();
    expect(await schedule()).toEqual(original);
    expectWarmRead();
  });

  it('keeps health uncached and does not cache invalid requests or their errors', async () => {
    const dto = await schedule();
    const entries = [...backend.cache.entries];
    for (const request of [
      () => schedule('unknown'),
      () => schedule('ermolz', 'SEM-NOT-FOUND'),
    ]) {
      await expect(request()).rejects.toBeInstanceOf(ApiError);
      expect([...backend.cache.entries]).toEqual(entries);
    }
    resetReads();
    expect((await getApiHealth()).revision).toBe(dto.revision);
    expectColdRead();
    expect([...backend.cache.entries]).toEqual(entries);
  });
});

describe('cache invalidation follows committed state', () => {
  it.each(['seed', 'upgrade', 'unchanged'] as const)(
    'keeps setup safe under the cache lock: %s',
    async (operation) => {
      const data = backend.snapshot();
      if (operation === 'seed') {
        Object.keys(data).forEach((name) => {
          data[name] = [];
        });
      } else if (operation === 'upgrade') {
        data.Meta.find((row) => row.key === 'schema_version')!.value = '1';
        data.UserPreferences = [];
      }
      backend.replaceDatabase(data);
      const result = backend.setup();
      expect(result).toMatchObject({
        seeded: operation === 'seed',
        spreadsheetId: 'isolated-test-sheet',
      });
      expect(backend.storage.events[0]).toBe('lock');
      expect(backend.storage.events.at(-1)).toBe('unlock');
      if (operation === 'unchanged') {
        expect(backend.storage.writes).toEqual([]);
        expect(backend.snapshot()).toEqual(data);
      } else {
        expect(backend.storage.events.at(-2)).toBe('flush');
        expect(backend.properties.has('SCHEDULER_CACHE_WRITE_PENDING')).toBe(
          false,
        );
      }
      const dto = await schedule();
      resetReads();
      expect(await schedule()).toEqual(dto);
      expectWarmRead();
    },
  );

  it('invalidates all revisions after import and undo, without publishing drafts into cache', async () => {
    const original = await schedule();
    const originalKey = currentKey();
    const entries = [...backend.cache.entries];
    const args = newSubjectImport(original);
    await importPersonalSchedule({ ...args, dryRun: true });
    expect([...backend.cache.entries]).toEqual(entries);
    const imported = await importPersonalSchedule(args);
    expect([...backend.cache.entries]).toEqual(entries);
    resetReads();
    const afterImport = await schedule();
    expectColdRead();
    expect(afterImport).toEqual(imported.schedule);
    expect(currentKey()).not.toBe(originalKey);
    expect(backend.cache.entries.has(originalKey)).toBe(true); // expires naturally, never consulted for the new revision
    const afterUndo = await undoLastImport({
      token: backend.token,
      baseRevision: afterImport.revision,
    });
    resetReads();
    const restored = await schedule();
    expectColdRead();
    expect(restored).toEqual(afterUndo.schedule);
    expect(restored.subjects).toEqual(original.subjects);
    expect(restored.revision).toBe(original.revision + 2);
    resetReads();
    await schedule();
    expectWarmRead();
  });

  it('refreshes settings at the same data revision without invalidating another user', async () => {
    const first = await schedule();
    const member = await createMember(first.revision);
    const original = await schedule();
    const oldKey = currentKey();
    const other = await schedule(member.user.slug);
    const otherKey = currentKey();
    await updatePreferences({
      userSlug: 'ermolz',
      token: backend.token,
      baseSettingsRevision: original.preferencesRevision!,
      patch: { appearance: { mode: 'dark' } },
    });
    resetReads();
    const updated = await schedule();
    expectColdRead();
    expect(updated.revision).toBe(original.revision);
    expect(updated.preferencesRevision).toBe(original.preferencesRevision! + 1);
    expect(updated.preferences?.appearance.mode).toBe('dark');
    expect(currentKey()).not.toBe(oldKey);
    resetReads();
    expect(await schedule(member.user.slug)).toEqual(other);
    expect(currentKey()).toBe(otherKey);
    expectWarmRead();
  });

  it('refreshes enrollments after a committed update', async () => {
    const original = await schedule();
    const updated = await updateEnrollments({
      userSlug: original.user.slug,
      token: backend.token,
      semesterId: original.semester.id,
      baseRevision: original.revision,
      enrollments: [],
    });
    resetReads();
    const dto = await schedule();
    expectColdRead();
    expect(dto).toEqual(updated.schedule);
    expect(dto.subjects).toEqual([]);
    expect(dto.lessons).toEqual([]);
  });

  it('refreshes user metadata and refuses a now-inactive cached user', async () => {
    const original = await schedule();
    const member = await createMember(original.revision);
    await schedule(member.user.slug);
    const renamed = await updateAdminUser(
      backend.token,
      member.revision,
      member.user.id,
      { displayName: 'Renamed', role: 'editor' },
    );
    resetReads();
    const dto = await schedule(member.user.slug);
    expectColdRead();
    expect(dto.user).toMatchObject({ displayName: 'Renamed', role: 'editor' });
    await setAdminUserActive(
      backend.token,
      renamed.revision,
      member.user.id,
      false,
    );
    const count = backend.cache.entries.size;
    await expect(schedule(member.user.slug)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    expect(backend.cache.entries.size).toBe(count);
    expect(
      (await schedule()).users.some((user) => user.id === member.user.id),
    ).toBe(false);
  });

  it('separates semesters and invalidates current/archive metadata immediately', async () => {
    const original = await schedule();
    const created = await createSemester({
      token: backend.token,
      baseRevision: original.revision,
      semester: {
        id: 'SEM-CACHE-SPRING',
        title: 'Cache Spring',
        startDate: '2027-02-01',
        weeksCount: 16,
      },
      sourceSemesterId: original.semester.id,
      copySubjects: true,
      makeCurrent: true,
    });
    const current = await schedule();
    const currentKeyBeforeArchive = currentKey();
    expect(current.semester.id).toBe('SEM-CACHE-SPRING');
    expect(current.lessons).toEqual([]);
    const previous = await schedule('ermolz', original.semester.id);
    expect(currentKey()).not.toBe(currentKeyBeforeArchive);
    expect(previous.lessons).toEqual(original.lessons);
    resetReads();
    expect(await schedule()).toEqual(current);
    expectWarmRead();
    await archiveSemester({
      token: backend.token,
      baseRevision: created.revision,
      semesterId: original.semester.id,
    });
    resetReads();
    const archived = await schedule('ermolz', original.semester.id);
    expectColdRead();
    expect(
      archived.semesters?.find(
        (semester) => semester.id === original.semester.id,
      )?.archived,
    ).toBe(true);
    expect(archived.lessons).toEqual(original.lessons);
  });

  it('fingerprints metadata repairs even when they do not increment data_revision', async () => {
    const original = await schedule();
    const oldKey = currentKey();
    const data = backend.snapshot();
    data.Users[0].display_name = 'Manual metadata repair';
    backend.replaceDatabase(data);
    resetReads();
    const repaired = await schedule();
    expectColdRead();
    expect(repaired.user.displayName).toBe('Manual metadata repair');
    expect(repaired.revision).toBe(original.revision);
    expect(currentKey()).not.toBe(oldKey);
    const broken = backend.snapshot();
    broken.UserPreferences[0].density = 'invalid';
    backend.replaceDatabase(broken);
    await expect(schedule()).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('keeps a valid cache after rejected writes without advancing any revision', async () => {
    const original = await schedule();
    const entries = [...backend.cache.entries];
    const before = backend.snapshot();
    await expect(
      importPersonalSchedule({
        ...newSubjectImport(original),
        baseRevision: original.revision + 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_DATA' });
    expect(backend.snapshot()).toEqual(before);
    expect([...backend.cache.entries]).toEqual(entries);
    resetReads();
    expect(await schedule()).toEqual(original);
    expectWarmRead();
  });

  it.each(['table', 'flush'] as const)(
    'bypasses old cache after a %s write failure and never resurrects it after recovery',
    async (fault) => {
      const original = await schedule();
      const member = await createMember(original.revision);
      const before = await schedule();
      await schedule(member.user.slug);
      const oldKeys = [...backend.cache.entries.keys()];
      if (fault === 'table') backend.storage.failWriteFor = 'AuditLog';
      else backend.storage.failFlush = true;
      await expect(
        updatePreferences({
          userSlug: 'ermolz',
          token: backend.token,
          baseSettingsRevision: before.preferencesRevision!,
          patch: { appearance: { mode: 'dark' } },
        }),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(backend.properties.get('SCHEDULER_CACHE_WRITE_PENDING')).toBe(
        'yes',
      );
      expect(backend.storage.events).toContain('flush');
      expect(backend.storage.events.indexOf('flush')).toBeLessThan(
        backend.storage.events.lastIndexOf('unlock'),
      );
      backend.storage.failWriteFor = '';
      backend.storage.failFlush = false;
      resetReads();
      const uncached = await schedule();
      expectColdRead();
      expect(uncached.preferences?.appearance.mode).toBe('dark');
      expect([...backend.cache.entries.keys()]).toEqual(oldKeys);
      // A successful write for a DIFFERENT user may clear the bypass marker,
      // but must not make any old same-revision cache entries eligible again.
      await updatePreferences({
        userSlug: member.user.slug,
        token: member.editToken!,
        baseSettingsRevision: 0,
        patch: { schedule: { density: 'compact' } },
      });
      expect(backend.properties.has('SCHEDULER_CACHE_WRITE_PENDING')).toBe(
        false,
      );
      expect(
        backend.properties.get('SCHEDULER_CACHE_RECOVERY_EPOCH'),
      ).toBeTruthy();
      resetReads();
      const recovered = await schedule();
      expectColdRead();
      expect(recovered).toEqual(uncached);
      expect(oldKeys).not.toContain(currentKey());
      resetReads();
      expect(await schedule()).toEqual(recovered);
      expectWarmRead();
    },
  );
});
