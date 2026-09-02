// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_VERSION, ApiError, parseApiResponse } from '@/lib/api/client';
import { createAdminUser, setAdminUserActive } from '@/lib/admin/repository';
import { updatePreferences } from '@/lib/preferences/repository';
import { archiveSemester, createSemester } from '@/lib/semesters/repository';
import { buildImportDiff } from '@/lib/schedule/import-diff';
import { exportSchedule, validateScheduleImport } from '@/lib/schedule/import';
import {
  fetchSchedule,
  importPersonalSchedule,
  readCachedSchedule,
  readLastSync,
  updateEnrollments,
} from '@/lib/schedule/repository';
import {
  dayOrder,
  getConflictIds,
  getLessonsForDay,
  getWeekDates,
} from '@/lib/schedule/utils';
import type { ScheduleImportV1, UserSchedule } from '@/lib/schedule/types';
import { createTestBackend } from './support/apps-script-backend';
import { assertContract, contractIssues } from './support/typescript-contract';

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

function builtSchedule(slug = 'ermolz', semesterId?: string) {
  const value = backend.buildSchedule(slug, semesterId);
  assertContract('UserSchedule', value);
  return value;
}

function importArgs(schedule = builtSchedule()) {
  return {
    userSlug: schedule.user.slug,
    token: backend.token,
    schedule: exportSchedule(schedule),
    mode: 'merge' as const,
    baseRevision: schedule.revision,
  };
}

function storageSnapshot() {
  return Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key)];
    }),
  );
}

async function expectApiFailure(
  operation: () => Promise<unknown>,
  code: string,
  revision: number,
  details: unknown = null,
) {
  const databaseBefore = backend.snapshot();
  const storageBefore = storageSnapshot();
  const firstCall = backend.calls.length;
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ApiError);
  if (!(failure instanceof ApiError))
    throw new Error('Expected an ApiError from the real backend');
  expect(failure).toMatchObject({ code, revision, details });
  expect(failure.message.length).toBeGreaterThan(0);
  expect(backend.calls.at(-1)?.response).toEqual({
    apiVersion: API_VERSION,
    ok: false,
    error: { code, message: failure.message, details },
    revision,
  });
  // An error is neither success data nor permission to retry a write. No partial
  // edits, revision bump, AuditLog entries, or poisoned cache may survive it.
  expect(
    backend.calls.slice(firstCall).filter((call) => call.action !== 'health'),
  ).toHaveLength(1);
  expect(backend.snapshot()).toEqual(databaseBefore);
  expect(storageSnapshot()).toEqual(storageBefore);
  return failure;
}

async function createEmptyUser() {
  const schedule = builtSchedule();
  return createAdminUser(backend.token, schedule.revision, {
    displayName: 'Contract User',
    slug: 'contract-user',
    role: 'user',
  });
}

async function createNextSemester() {
  const schedule = builtSchedule();
  return createSemester({
    token: backend.token,
    baseRevision: schedule.revision,
    semester: {
      id: 'SEM-CONTRACT-SPRING',
      title: 'Contract Spring',
      startDate: '2027-02-01',
      weeksCount: 16,
    },
    sourceSemesterId: schedule.semester.id,
    copySubjects: true,
    makeCurrent: true,
  });
}

describe('buildUserSchedule_ → JSON → TypeScript frontend contract', () => {
  it('validates the actual builder DTO, API envelope, repository, cache and frontend consumers', async () => {
    const dto = builtSchedule();
    const fromRepository = await fetchSchedule(dto.user.slug);
    const envelope = backend.calls.at(-1)?.response;
    const decoded: unknown = parseApiResponse(envelope);
    assertContract('UserSchedule', decoded);
    expect(decoded).toEqual(dto);
    expect(fromRepository).toEqual(dto);
    expect(readCachedSchedule(dto.user.slug, dto.semester.id)).toEqual(dto);
    expect(
      Number.isNaN(Date.parse(readLastSync(dto.user.slug, dto.semester.id))),
    ).toBe(false);

    expect(dto.subjects.length).toBeGreaterThan(0);
    expect(dto.lessons.length).toBeGreaterThan(0);
    expect(dto.preferencesExists).toBe(false);
    expect(dto.preferencesRevision).toBe(0);
    expect(dto.preferences?.version).toBe(1);
    expect(dto.currentSemesterId).toBe(dto.semester.id);
    expect(dto.semesters).toContainEqual({
      ...dto.semester,
      current: true,
      archived: false,
    });
    expect(
      dto.subjects.some((subject) => subject.selectedGroup !== undefined),
    ).toBe(true);
    expect(dto.lessons.some((lesson) => !Object.hasOwn(lesson, 'group'))).toBe(
      true,
    );
    expect(dto.lessons.some((lesson) => !Object.hasOwn(lesson, 'room'))).toBe(
      true,
    );
    for (const lesson of dto.lessons) {
      expect(
        dto.subjects.some(
          (subject) =>
            subject.id === lesson.subjectId &&
            subject.offeringId === lesson.offeringId,
        ),
      ).toBe(true);
      expect(lesson.weeks).toEqual(
        [...new Set(lesson.weeks)].sort((a, b) => a - b),
      );
      expect(
        lesson.weeks.every(
          (week) =>
            Number.isInteger(week) &&
            week >= 1 &&
            week <= dto.semester.weeksCount,
        ),
      ).toBe(true);
    }
    const wire = JSON.stringify(envelope);
    expect(wire).not.toMatch(
      /edit_token_hash|editToken|edit_token|baseSettingsRevision/,
    );
    expect(wire).not.toContain(backend.token);

    const exported = exportSchedule(decoded);
    assertContract('ScheduleImportV1', exported);
    expect(
      validateScheduleImport(exported, decoded.semester.weeksCount).errors,
    ).toEqual([]);
    for (let week = 1; week <= decoded.semester.weeksCount; week++) {
      const visible = dayOrder.flatMap((day) =>
        getLessonsForDay(decoded.lessons, week, day),
      );
      expect(visible).toHaveLength(
        decoded.lessons.filter((lesson) => lesson.weeks.includes(week)).length,
      );
      expect(
        [...getConflictIds(decoded.lessons, week)].every((id) =>
          visible.some((lesson) => lesson.id === id),
        ),
      ).toBe(true);
      expect(
        Object.values(getWeekDates(decoded.semester.startDate, week)).every(
          (date) => !Number.isNaN(date.getTime()),
        ),
      ).toBe(true);
    }
  });

  it('round-trips the frontend export through preview and import without changing the database', async () => {
    const args = importArgs();
    const before = backend.snapshot();
    const preview = await importPersonalSchedule({ ...args, dryRun: true });
    assertContract('ImportPlanResponse', preview);
    expect(preview).toMatchObject({
      revision: args.baseRevision,
      plan: [],
      conflicts: [],
    });
    expect(preview.schedule).toBeUndefined();
    const applied = await importPersonalSchedule(args);
    assertContract('ImportPlanResponse', applied);
    expect(applied.schedule).toEqual(builtSchedule());
    expect(applied.plan).toEqual([]);
    expect(applied.revision).toBe(args.baseRevision);
    expect(backend.snapshot()).toEqual(before);
  });

  it('returns a valid DTO after a real import with new lessons, sparse weeks and optional fields', async () => {
    const args = importArgs();
    args.schedule.subjects = [
      {
        externalCode: 'CONTRACT-101',
        name: 'Контракт: нова дисципліна',
        shortName: 'Contract',
        color: '#123456',
        lessons: dayOrder.map((day, index) => ({
          type: 'lecture',
          day,
          startTime: '09:00',
          endTime: '10:00',
          weeks: [1, 3, 14],
          format: (['offline', 'online', 'hybrid'] as const)[index % 3],
          teacher: 'Contract Teacher',
          ...(index % 2 ? { room: 'B-42' } : {}),
        })),
      },
    ];
    const applied = await importPersonalSchedule(args);
    assertContract('ImportPlanResponse', applied);
    assertContract('UserSchedule', applied.schedule);
    expect(applied.revision).toBe(args.baseRevision + 1);
    expect(applied.schedule).toEqual(builtSchedule());
    const diff = buildImportDiff(applied);
    expect(diff.newSubjects).toHaveLength(1);
    expect(diff.newLessons).toHaveLength(dayOrder.length);
    const added = applied.schedule.lessons.filter(
      (lesson) => lesson.teacher === 'Contract Teacher',
    );
    expect(added).toHaveLength(dayOrder.length);
    expect(added.map((lesson) => lesson.format)).toEqual([
      'offline',
      'online',
      'hybrid',
      'offline',
      'online',
      'hybrid',
    ]);
    expect(added.every((lesson) => lesson.weeks.join(',') === '1,3,14')).toBe(
      true,
    );
    expect(
      validateScheduleImport(exportSchedule(applied.schedule), 14).errors,
    ).toEqual([]);
  });

  it('preserves numeric groups after enrollment changes and excludes other groups', async () => {
    const before = builtSchedule();
    const subject = before.subjects.find(
      (item) => (item.availableGroups?.length ?? 0) > 1,
    )!;
    expect(subject).toBeDefined();
    const selectedGroup = subject.availableGroups!.find(
      (group) => group !== subject.selectedGroup,
    )!;
    const result = await updateEnrollments({
      userSlug: before.user.slug,
      token: backend.token,
      semesterId: before.semester.id,
      baseRevision: before.revision,
      enrollments: before.subjects.map((item) => ({
        externalCode: item.externalCode!,
        selectedGroup:
          item.id === subject.id ? selectedGroup : item.selectedGroup,
      })),
    });
    assertContract('UserSchedule', result.schedule);
    expect(result.schedule).toEqual(builtSchedule());
    expect(
      result.schedule.subjects.find((item) => item.id === subject.id)
        ?.selectedGroup,
    ).toBe(selectedGroup);
    const groups = result.schedule.lessons.filter(
      (lesson) => lesson.subjectId === subject.id && lesson.group !== undefined,
    );
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((lesson) => lesson.group === selectedGroup)).toBe(true);
    expect(
      result.schedule.lessons.some(
        (lesson) =>
          lesson.subjectId === subject.id && lesson.type === 'lecture',
      ),
    ).toBe(true);
  });

  it('handles an active user with no enrollments and returns only public user fields', async () => {
    const created = await createEmptyUser();
    const dto = builtSchedule(created.user.slug);
    expect(dto.subjects).toEqual([]);
    expect(dto.lessons).toEqual([]);
    expect(dto.user).toEqual({
      id: created.user.id,
      slug: 'contract-user',
      displayName: 'Contract User',
      role: 'user',
    });
    expect(await fetchSchedule(created.user.slug)).toEqual(dto);
    expect(dto.users).toHaveLength(2);
    expect(JSON.stringify(dto)).not.toContain(created.editToken);
  });

  it('includes saved settings with their independent numeric revision', async () => {
    const before = builtSchedule();
    const result = await updatePreferences({
      userSlug: before.user.slug,
      token: backend.token,
      baseSettingsRevision: before.preferencesRevision!,
      patch: {
        appearance: { mode: 'dark' },
        schedule: {
          defaultView: 'subjects',
          density: 'compact',
          showSaturday: true,
        },
      },
    });
    const dto = builtSchedule();
    expect(dto.preferences).toEqual(result.preferences);
    expect(dto.preferences?.schedule).toMatchObject({
      defaultView: 'subjects',
      density: 'compact',
      showSaturday: true,
    });
    expect(dto.preferencesExists).toBe(true);
    expect(dto.preferencesRevision).toBe(before.preferencesRevision! + 1);
    expect(dto.revision).toBe(before.revision);
    expect(await fetchSchedule(dto.user.slug)).toEqual(dto);
  });

  it('uses the new current semester, while the archived semester remains readable', async () => {
    const old = builtSchedule();
    const created = await createNextSemester();
    expect(created.copiedSubjects).toBeGreaterThan(0);
    await archiveSemester({
      token: backend.token,
      baseRevision: created.revision,
      semesterId: old.semester.id,
    });
    const current = await fetchSchedule(old.user.slug);
    assertContract('UserSchedule', current);
    expect(current.semester.id).toBe('SEM-CONTRACT-SPRING');
    expect(current.semester.weeksCount).toBe(16);
    expect(current.currentSemesterId).toBe(current.semester.id);
    expect(current.subjects).toEqual([]);
    expect(current.lessons).toEqual([]);
    const archived = await fetchSchedule(old.user.slug, old.semester.id);
    assertContract('UserSchedule', archived);
    expect(archived.lessons).toEqual(old.lessons);
    expect(archived.semesters).toContainEqual({
      ...old.semester,
      archived: true,
      current: false,
    });
    expect(
      readCachedSchedule(old.user.slug, current.semester.id)?.lessons,
    ).toEqual([]);
    expect(readCachedSchedule(old.user.slug, old.semester.id)?.lessons).toEqual(
      old.lessons,
    );
  });
});

describe('real Apps Script failures → frontend ApiError contract', () => {
  it.each(['preview', 'import', 'enrollments'] as const)(
    'preserves STALE_DATA revisions for %s',
    async (operation) => {
      const cached = await fetchSchedule('ermolz');
      const args = importArgs(cached);
      const updated = await createEmptyUser();
      await expectApiFailure(
        () =>
          operation === 'enrollments'
            ? updateEnrollments({
                userSlug: 'ermolz',
                token: backend.token,
                semesterId: cached.semester.id,
                baseRevision: cached.revision,
                enrollments: [],
              })
            : importPersonalSchedule({
                ...args,
                dryRun: operation === 'preview',
              }),
        'STALE_DATA',
        updated.revision,
        {
          expectedRevision: updated.revision,
          receivedRevision: cached.revision,
        },
      );
      expect(readCachedSchedule('ermolz', cached.semester.id)?.revision).toBe(
        cached.revision,
      );
    },
  );

  it('preserves per-course subject and lesson conflicts, without committing earlier plan items', async () => {
    const args = importArgs();
    const changed = args.schedule.subjects
      .filter((subject) => subject.lessons?.length)
      .slice(0, 2);
    changed[0].name += ' changed';
    changed[0].lessons![0].room = 'CONTRACT-A';
    changed[1].lessons![0].room = 'CONTRACT-B';
    args.schedule.subjects = [
      {
        externalCode: 'CONTRACT-PARTIAL',
        name: 'Must not be persisted',
        lessons: [],
      },
      ...changed,
    ];
    const before = backend.snapshot();
    const preview = await importPersonalSchedule({ ...args, dryRun: true });
    assertContract('ImportPlanResponse', preview);
    expect(preview.conflicts).toHaveLength(3);
    for (const conflict of preview.conflicts!)
      assertContract('ImportSharedConflict', conflict);
    expect(
      preview
        .conflicts!.map((conflict) => conflict.kind)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['lesson', 'lesson', 'subject']);
    expect(
      preview.conflicts!.every(
        (conflict) => !Object.hasOwn(conflict, 'resolution'),
      ),
    ).toBe(true);
    const diff = buildImportDiff(preview);
    expect(diff.newSubjects).toHaveLength(1);
    expect(diff.conflictsBySubject.map((group) => group.externalCode)).toEqual(
      changed.map((subject) => subject.externalCode),
    );
    expect(backend.snapshot()).toEqual(before);
    await expectApiFailure(
      () => importPersonalSchedule(args),
      'COURSE_DATA_CONFLICT',
      args.baseRevision,
      preview.conflicts,
    );

    const resolved = await importPersonalSchedule({
      ...args,
      dryRun: true,
      sharedConflictResolutions: {
        [changed[0].externalCode]: 'apply',
        [changed[1].externalCode]: 'keep',
      },
    });
    assertContract('ImportPlanResponse', resolved);
    expect(resolved.conflicts!.map((conflict) => conflict.resolution)).toEqual([
      'apply',
      'apply',
      'keep',
    ]);
    expect(buildImportDiff(resolved).changedLessons).toHaveLength(1);
    expect(backend.snapshot()).toEqual(before);
  });

  it.each([
    '',
    'short',
    'invalid-token-with-a-valid-length-but-no-matching-user',
  ])('rejects an invalid token %j as UNAUTHORIZED', async (token) => {
    const args = importArgs();
    await expectApiFailure(
      () => importPersonalSchedule({ ...args, token }),
      'UNAUTHORIZED',
      args.baseRevision,
    );
  });

  it.each(['read', 'own token', 'admin write'] as const)(
    'rejects an inactive user: %s',
    async (operation) => {
      const created = await createEmptyUser();
      const cached = await fetchSchedule(created.user.slug);
      const deactivated = await setAdminUserActive(
        backend.token,
        created.revision,
        created.user.id,
        false,
        false,
      );
      const args = {
        ...importArgs(cached),
        baseRevision: deactivated.revision,
      };
      await expectApiFailure(
        () =>
          operation === 'read'
            ? fetchSchedule(created.user.slug)
            : importPersonalSchedule({
                ...args,
                token:
                  operation === 'own token'
                    ? created.editToken!
                    : backend.token,
              }),
        operation === 'own token' ? 'UNAUTHORIZED' : 'USER_NOT_FOUND',
        deactivated.revision,
      );
      const active = await fetchSchedule('ermolz');
      expect(active.users.some((user) => user.id === created.user.id)).toBe(
        false,
      );
    },
  );

  it.each(['read', 'preview', 'import', 'enrollments'] as const)(
    'rejects an unknown semester for %s',
    async (operation) => {
      const cached = await fetchSchedule('ermolz');
      const args = importArgs(cached);
      const semesterId = 'SEM-DOES-NOT-EXIST';
      args.schedule.semesterId = semesterId;
      await expectApiFailure(
        () =>
          operation === 'read'
            ? fetchSchedule('ermolz', semesterId)
            : operation === 'enrollments'
              ? updateEnrollments({
                  userSlug: 'ermolz',
                  token: backend.token,
                  baseRevision: cached.revision,
                  semesterId,
                  enrollments: [],
                })
              : importPersonalSchedule({
                  ...args,
                  dryRun: operation === 'preview',
                }),
        'SEMESTER_NOT_FOUND',
        cached.revision,
      );
      expect(readCachedSchedule('ermolz', semesterId)).toBeNull();
    },
  );

  it.each(['preview', 'import', 'enrollments'] as const)(
    'rejects an archived semester for %s, without confusing it with a missing read',
    async (operation) => {
      const old = builtSchedule();
      const created = await createNextSemester();
      const archived = await archiveSemester({
        token: backend.token,
        baseRevision: created.revision,
        semesterId: old.semester.id,
      });
      const schedule = await fetchSchedule(old.user.slug, old.semester.id);
      assertContract('UserSchedule', schedule);
      await expectApiFailure(
        () =>
          operation === 'enrollments'
            ? updateEnrollments({
                userSlug: old.user.slug,
                token: backend.token,
                baseRevision: archived.revision,
                semesterId: old.semester.id,
                enrollments: [],
              })
            : importPersonalSchedule({
                ...importArgs(schedule),
                dryRun: operation === 'preview',
              }),
        'SEMESTER_NOT_FOUND',
        archived.revision,
      );
    },
  );
});

describe('contract checker regression guards', () => {
  // These mutations must fail even if a generic fetch<UserSchedule>() would
  // compile: the runtime JSON is checked against the current .ts declarations.
  it.each([
    [
      'renamed required field',
      (dto: UserSchedule) => ({
        ...dto,
        user: {
          id: dto.user.id,
          slug: dto.user.slug,
          display_name: dto.user.displayName,
          role: dto.user.role,
        },
      }),
    ],
    ['string revision', (dto: UserSchedule) => ({ ...dto, revision: '1' })],
    [
      'string week',
      (dto: UserSchedule) => ({
        ...dto,
        lessons: [{ ...dto.lessons[0], weeks: ['1'] }],
      }),
    ],
    [
      'string group',
      (dto: UserSchedule) => ({
        ...dto,
        subjects: [{ ...dto.subjects[0], selectedGroup: '3' }],
      }),
    ],
    [
      'invalid weekday',
      (dto: UserSchedule) => ({
        ...dto,
        lessons: [{ ...dto.lessons[0], day: 'sunday' }],
      }),
    ],
    [
      'invalid format',
      (dto: UserSchedule) => ({
        ...dto,
        lessons: [{ ...dto.lessons[0], format: 'remote' }],
      }),
    ],
    [
      'null optional room',
      (dto: UserSchedule) => ({
        ...dto,
        lessons: [{ ...dto.lessons[0], room: null }],
      }),
    ],
    [
      'invalid nested settings',
      (dto: UserSchedule) => ({
        ...dto,
        preferences: {
          ...dto.preferences,
          schedule: { ...dto.preferences!.schedule, density: 'tiny' },
        },
      }),
    ],
    [
      'invalid theme from imported types',
      (dto: UserSchedule) => ({
        ...dto,
        preferences: {
          ...dto.preferences,
          appearance: {
            ...dto.preferences!.appearance,
            themeId: 'not-a-theme',
          },
        },
      }),
    ],
    [
      'string archived flag',
      (dto: UserSchedule) => ({
        ...dto,
        semesters: [{ ...dto.semesters![0], archived: 'false' }],
      }),
    ],
    [
      'missing required unknown field',
      () => ({
        revision: 1,
        plan: [
          {
            action: 'CREATE',
            entityType: 'Subject',
            entityId: 'NEW',
            newValue: {},
          },
        ],
      }),
    ],
  ] as const)('catches %s', (name, mutate) => {
    const type =
      name === 'missing required unknown field'
        ? 'ImportPlanResponse'
        : 'UserSchedule';
    expect(
      contractIssues(type, mutate(builtSchedule())).length,
    ).toBeGreaterThan(0);
  });

  it('allows additive fields and omission of optional fields, without accepting null instead', () => {
    const dto = builtSchedule();
    assertContract('UserSchedule', {
      ...dto,
      futureBackendField: true,
      preferences: undefined,
    });
    const invalidExport: unknown = { ...exportSchedule(dto), schemaVersion: 2 };
    expect(
      contractIssues('ScheduleImportV1', invalidExport).length,
    ).toBeGreaterThan(0);
    const exported: ScheduleImportV1 = exportSchedule(dto);
    assertContract('ScheduleImportV1', exported);
  });
});
