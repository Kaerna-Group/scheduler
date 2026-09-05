import { beforeEach, describe, expect, it } from 'vitest';
import { createTestBackend } from './support/apps-script-backend';

type Row = Record<string, string>;
interface Plan {
  planId: string;
  baseRevision: number;
  requiresConfirmation: boolean;
  confirmationReasons: string[];
  changes: Array<{
    table: string;
    key: string;
    before: Row | null;
    after: Row | null;
  }>;
  affectedUsers: Array<{ user: { id: string }; semesterId: string }>;
}
interface Result {
  operationId: string;
  planId: string;
  revision: number;
}
const scopes = [
  'catalog:read',
  'users:read',
  'lessons:write',
  'catalog:write',
  'enrollments:write',
  'history:read',
  'changes:undo',
];
let backend: ReturnType<typeof createTestBackend>;
let credentials: { integrationId: string; integrationToken: string };
function success<T>(response: unknown): T {
  expect(response, JSON.stringify(response)).toMatchObject({
    apiVersion: 1,
    ok: true,
  });
  return (response as { data: T }).data;
}
function request(action: string, input: Record<string, unknown> = {}) {
  return backend.post({
    apiVersion: 1,
    action: 'control.' + action,
    integrationId: credentials.integrationId,
    integrationToken: credentials.integrationToken,
    ...input,
  });
}
const move = {
  type: 'lesson.move',
  lessonId: 'LES-SCRUM-LECTURE',
  startTime: '17:00',
  fromWeek: 3,
};
function plan(commands: unknown[] = [move]) {
  return success<Plan>(
    request('changes.plan', {
      commands,
      initiator: 'test operator',
      reason: 'Reviewed test change',
    }),
  );
}
function apply(prepared: Plan, operationId = 'OP-FIRST', confirm = false) {
  return request('changes.apply', {
    planId: prepared.planId,
    operationId,
    ...(confirm ? { confirmPlanId: prepared.planId } : {}),
  });
}
function setup(transformSource?: (source: string) => string) {
  backend = createTestBackend({ transformSource });
  backend.setupControl();
  credentials = backend.createIntegration(
    'test-integration',
    scopes,
  ) as typeof credentials;
}
beforeEach(() => setup());

describe('integration isolation and typed commands', () => {
  it('stores only a workbook-bound integration hash and creates no user', () => {
    expect(backend.snapshot().Users).toHaveLength(1);
    expect(JSON.stringify([...backend.properties])).not.toContain(
      credentials.integrationToken,
    );
    expect(
      JSON.parse(
        backend.properties.get('SCHEDULER_INTEGRATION_test-integration')!,
      ),
    ).toMatchObject({ spreadsheetId: 'isolated-test-sheet', active: true });
    expect(success<{ users: unknown[] }>(request('users')).users).toEqual([
      { id: 'U001', slug: 'ermolz', displayName: 'Ermolz' },
    ]);
  });

  it.each([
    'adminCreateUser',
    'adminUpdateUser',
    'adminSetUserActive',
    'adminRotateUserToken',
    'updatePreferences',
    'importSchedule',
    'updateEnrollments',
  ])('rejects integration credentials on %s', (action) => {
    const before = backend.snapshot();
    expect(
      backend.post({ action, ...credentials, editToken: backend.token }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      backend.post({ action, editToken: credentials.integrationToken }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(backend.snapshot()).toEqual(before);
  });

  it.each([
    'user.create',
    'user.update',
    'preferences.update',
    'writeTable',
    'updateCell',
    'script.execute',
    '__proto__',
  ])('rejects unsupported command %s', (type) => {
    expect(
      request('changes.plan', { commands: [{ type }], initiator: 'operator' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(backend.snapshot().ControlPlans).toEqual([]);
  });

  it('rejects field injection and insufficient scopes, including after planning', () => {
    expect(
      request('changes.plan', {
        commands: [{ ...move, edit_token_hash: 'injected' }],
        initiator: 'operator',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const prepared = plan();
    const key = 'SCHEDULER_INTEGRATION_test-integration';
    const integration = JSON.parse(backend.properties.get(key)!);
    integration.scopes = ['catalog:read', 'users:read'];
    backend.properties.set(key, JSON.stringify(integration));
    expect(apply(prepared)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      request('changes.plan', { commands: [move], initiator: 'operator' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('revokes access immediately, including saved plans', () => {
    const prepared = plan();
    backend.revokeIntegration(credentials.integrationId);
    expect(apply(prepared)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(request('catalog')).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('never selects one lesson from ambiguous search results', () => {
    const found = success<{ count: number; ambiguous: boolean }>(
      request('lessons.find', { filters: { course: '565095' } }),
    );
    expect(found.count).toBe(4);
    expect(found.ambiguous).toBe(true);
    expect(
      request('changes.plan', {
        commands: [
          { type: 'lesson.move', course: '565095', startTime: '17:00' },
        ],
        initiator: 'operator',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('durable plans, atomic writes, idempotency and verification', () => {
  it('moves selected weeks for every participant, preserving duration, groups and other weeks', () => {
    const member = success<{ user: { id: string } }>(
      backend.post({
        action: 'adminCreateUser',
        editToken: backend.token,
        baseRevision: 1,
        slug: 'member',
        displayName: 'Member',
        role: 'user',
      }),
    );
    const enrollment = plan([
      {
        type: 'enrollment.add',
        userId: member.user.id,
        offeringId: 'OFF-SCRUM-26',
        groupId: 'GR-SCRUM-3',
      },
    ]);
    success(apply(enrollment, 'OP-ENROLL', true));
    const before = backend.snapshot();
    const prepared = plan();
    expect(prepared.affectedUsers.map((check) => check.user.id).sort()).toEqual(
      ['U001', member.user.id].sort(),
    );
    expect(backend.snapshot().Lessons).toEqual(before.Lessons);
    const batchCount = backend.storage.batches.length;
    const result = success<Result>(apply(prepared));
    expect(backend.storage.batches).toHaveLength(batchCount + 1);
    expect(result.revision).toBe(prepared.baseRevision + 1);
    const after = backend.snapshot();
    expect(after.Users).toEqual(before.Users);
    expect(after.UserPreferences).toEqual(before.UserPreferences);
    expect(after.Enrollments).toEqual(before.Enrollments);
    expect(
      after.LessonWeeks.filter((row) => row.lesson_id === move.lessonId).map(
        (row) => row.week,
      ),
    ).toEqual(['1', '2']);
    const created = after.Lessons.find(
      (row) => !before.Lessons.some((old) => old.lesson_id === row.lesson_id),
    )!;
    expect(created).toMatchObject({
      offering_id: 'OFF-SCRUM-26',
      start_time: '17:00',
      end_time: '18:20',
    });
    expect(
      after.LessonWeeks.filter(
        (row) => row.lesson_id === created.lesson_id,
      ).map((row) => row.week),
    ).toEqual(['3', '4', '5', '6', '7']);
    const verification = success<{
      verified: boolean;
      participants: Array<{ matches: boolean }>;
    }>(request('changes.verify', { operationId: result.operationId }));
    expect(verification.verified).toBe(true);
    expect(verification.participants).toHaveLength(2);
    expect(verification.participants.every((check) => check.matches)).toBe(
      true,
    );
    expect(after.AuditLog.at(-1)).toMatchObject({
      actor_user_id: 'integration:test-integration',
      entity_type: 'ControlOperation',
      entity_id: 'OP-FIRST',
    });
    expect(JSON.parse(after.AuditLog.at(-1)!.new_value).initiator).toBe(
      'test operator',
    );
    expect(JSON.stringify(after)).not.toContain(credentials.integrationToken);
  });

  it('keeps the stable lesson ID for a whole-series move', () => {
    const before = backend.snapshot();
    success(apply(plan([{ ...move, fromWeek: 1 }])));
    expect(backend.snapshot().Lessons).toHaveLength(before.Lessons.length);
    expect(
      backend.snapshot().Lessons.find((row) => row.lesson_id === move.lessonId),
    ).toMatchObject({ start_time: '17:00', end_time: '18:20' });
  });

  it('preserves restricted group links in a partial move', () => {
    success(
      apply(plan([{ ...move, lessonId: 'LES-SCRUM-G3' }]), 'OP-FIRST', true),
    );
    const groupLinks = backend
      .snapshot()
      .LessonGroups.filter((row) => row.group_id === 'GR-SCRUM-3');
    expect(groupLinks).toHaveLength(2);
  });

  it('returns the exact committed result after a lost acknowledgement, without another write', () => {
    const prepared = plan();
    backend.storage.loseBatchResponse = true;
    expect(apply(prepared)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(backend.snapshot().ControlOperations).toHaveLength(1);
    const committed = JSON.parse(
      backend.snapshot().ControlOperations[0].result_json,
    );
    const batchCount = backend.storage.batches.length;
    backend.storage.loseBatchResponse = false;
    expect(success(apply(prepared))).toEqual(committed);
    expect(backend.storage.batches).toHaveLength(batchCount);
    expect(backend.snapshot().ControlOperations).toHaveLength(1);
    expect(
      success<{ verified: boolean }>(
        request('changes.verify', { operationId: 'OP-FIRST' }),
      ).verified,
    ).toBe(true);
    expect(apply(prepared, 'OP-DUPLICATE')).toMatchObject({
      ok: false,
      error: { code: 'PLAN_ALREADY_APPLIED' },
    });
  });

  it('rejects an entire batch if any table write fails, then safely retries', () => {
    const prepared = plan();
    const before = backend.snapshot();
    backend.storage.failWriteFor = 'ControlOperations';
    expect(apply(prepared)).toMatchObject({ ok: false });
    expect(backend.snapshot()).toEqual(before);
    backend.storage.failWriteFor = '';
    success(apply(prepared));
    expect(backend.snapshot().ControlOperations).toHaveLength(1);
  });

  it('does not replay a plan under a different owner or reuse an operation ID', () => {
    const prepared = plan();
    success(apply(prepared));
    const second = plan([
      { ...move, lessonId: 'LES-ELECTRONICS-LECTURE', fromWeek: 3 },
    ]);
    expect(apply(second)).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_ID_CONFLICT' },
    });
    credentials = backend.createIntegration(
      'other-integration',
      scopes,
    ) as typeof credentials;
    expect(apply(prepared)).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_ID_CONFLICT' },
    });
    expect(
      request('changes.verify', { operationId: 'OP-FIRST' }),
    ).toMatchObject({ ok: false, error: { code: 'OPERATION_NOT_FOUND' } });
    expect(
      success<{ operations: unknown[] }>(request('history')).operations,
    ).toEqual([]);
  });

  it.each(['revision', 'manual'])(
    'rejects stale plans after a %s change',
    (kind) => {
      const prepared = plan();
      const data = backend.snapshot();
      if (kind === 'revision')
        data.Meta.find((row) => row.key === 'data_revision')!.value = '2';
      else data.Lessons[0].room = 'Manual edit without revision';
      backend.replaceDatabase(data);
      expect(apply(prepared)).toMatchObject({
        ok: false,
        error: { code: 'STALE_DATA' },
      });
      expect(backend.snapshot().ControlOperations).toEqual([]);
    },
  );

  it('rejects expired and corrupt server plans', () => {
    setup((source) =>
      source.replace('Date.now() + 15 * 60 * 1000', 'Date.now() - 1000'),
    );
    expect(apply(plan())).toMatchObject({
      ok: false,
      error: { code: 'PLAN_EXPIRED' },
    });
    setup();
    const prepared = plan();
    const data = backend.snapshot();
    data.ControlPlans[0].plan_json = '{}';
    backend.replaceDatabase(data);
    expect(apply(prepared)).toMatchObject({
      ok: false,
      error: { code: 'PLAN_INVALID' },
    });
  });

  it('detects a duplicate lesson introduced after apply instead of trusting ok', () => {
    success(apply(plan()));
    const data = backend.snapshot();
    const changed = data.Lessons.at(-1)!;
    data.Lessons.push({ ...changed, lesson_id: 'LES-DUPLICATE' });
    data.LessonWeeks.push(
      ...data.LessonWeeks.filter(
        (row) => row.lesson_id === changed.lesson_id,
      ).map((row) => ({ ...row, lesson_id: 'LES-DUPLICATE' })),
    );
    backend.replaceDatabase(data);
    expect(
      success(request('changes.verify', { operationId: 'OP-FIRST' })),
    ).toMatchObject({
      verified: false,
      checks: { plannedStateMatches: false, participantSchedulesMatch: false },
    });
  });

  it('requires the reviewed plan ID for conflicts and bulk cancellation', () => {
    const conflict = plan([{ ...move, startTime: '13:30' }]);
    expect(conflict.confirmationReasons).toContain('SCHEDULE_CONFLICTS');
    expect(apply(conflict)).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    success(apply(conflict, 'OP-CONFLICT', true));
    const bulk = plan([
      { type: 'lesson.cancel', lessonId: 'LES-SCRUM-G1' },
      { type: 'lesson.cancel', lessonId: 'LES-SCRUM-G2' },
    ]);
    expect(bulk.confirmationReasons).toContain('BULK_REMOVAL');
    expect(apply(bulk, 'OP-BULK')).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
  });

  it('undoes only its own unchanged latest operation and leaves accounts/preferences intact', () => {
    const before = backend.snapshot();
    success(apply(plan()));
    success(
      apply(
        plan([{ type: 'changes.undo', operationId: 'OP-FIRST' }]),
        'OP-UNDO',
        true,
      ),
    );
    const after = backend.snapshot();
    for (const table of [
      'Users',
      'UserPreferences',
      'Lessons',
      'LessonGroups',
      'Enrollments',
    ])
      expect(after[table]).toEqual(before[table]);
    expect(
      after.LessonWeeks.slice().sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    ).toEqual(
      before.LessonWeeks.slice().sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    );
    expect(after.AuditLog.at(-1)?.action).toBe('CONTROL_UNDO');
    expect(
      request('changes.plan', {
        commands: [{ type: 'changes.undo', operationId: 'OP-FIRST' }],
        initiator: 'operator',
      }),
    ).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_AVAILABLE' } });
  });
});

describe('catalog and enrollment commands', () => {
  it('creates linked catalog records, a lesson and enrollment without changing the account', () => {
    const before = backend.snapshot();
    const prepared = plan([
      {
        type: 'semester.create',
        id: 'SEM-2027-SPRING',
        fields: { title: 'Spring', startDate: '2027-02-01', weeksCount: 14 },
      },
      {
        type: 'subject.create',
        id: 'SUB-NEW',
        fields: { name: '=literal', shortName: 'New', color: '#aabbcc' },
      },
      {
        type: 'offering.create',
        id: 'OFF-NEW',
        fields: {
          semesterId: 'SEM-2027-SPRING',
          subjectId: 'SUB-NEW',
          externalCode: 'NEW',
        },
      },
      {
        type: 'group.create',
        id: 'GR-NEW',
        fields: { offeringId: 'OFF-NEW', groupNumber: 1, label: 'Group 1' },
      },
      {
        type: 'lesson.create',
        offeringId: 'OFF-NEW',
        fields: {
          type: 'group',
          day: 'monday',
          startTime: '10:00',
          endTime: '11:20',
          format: 'offline',
          teacher: 'Teacher',
          room: '101',
          weeks: [1, 2],
          groupIds: ['GR-NEW'],
        },
      },
      {
        type: 'enrollment.add',
        userId: 'U001',
        offeringId: 'OFF-NEW',
        groupId: 'GR-NEW',
      },
    ]);
    success(apply(prepared));
    expect(backend.snapshot().Users).toEqual(before.Users);
    expect(backend.snapshot().UserPreferences).toEqual(before.UserPreferences);
    expect(backend.snapshot().Subjects.at(-1)?.name).toBe('=literal');
    expect(
      success(request('changes.verify', { operationId: 'OP-FIRST' })),
    ).toMatchObject({ verified: true });
    const found = success<{ enrollments: Row[] }>(
      request('enrollments.find', {
        filters: { offeringId: 'OFF-NEW', userId: 'U001' },
      }),
    );
    expect(found.enrollments).toHaveLength(1);
    const enrollmentId = found.enrollments[0].enrollment_id;
    success(
      apply(
        plan([{ type: 'enrollment.changeGroup', enrollmentId, groupId: null }]),
        'OP-GROUP',
      ),
    );
    success(
      apply(plan([{ type: 'enrollment.remove', enrollmentId }]), 'OP-REMOVE'),
    );
    expect(
      backend
        .snapshot()
        .Enrollments.find((row) => row.enrollment_id === enrollmentId)?.active,
    ).toBe('no');
  });

  it.each([
    { type: 'semester.archive', id: 'SEM-2026-FALL' },
    { type: 'group.archive', id: 'GR-SCRUM-3' },
    { type: 'subject.archive', id: 'SUB-SCRUM' },
    { type: 'semester.update', id: 'SEM-2026-FALL', fields: { weeksCount: 1 } },
    {
      type: 'offering.update',
      id: 'OFF-SCRUM-26',
      fields: { semesterId: 'SEM-OTHER' },
    },
    {
      type: 'enrollment.changeGroup',
      enrollmentId: 'ENR-ERMOLZ-02',
      groupId: 'GR-ELECTRONICS-5',
    },
    { type: 'lesson.move', lessonId: 'LES-SCRUM-LECTURE', startTime: '23:59' },
    {
      type: 'lesson.move',
      lessonId: 'LES-SCRUM-LECTURE',
      startTime: '17:00',
      weeks: [8],
    },
  ])('rejects invalid dependencies or constraints: $type', (command) => {
    const before = backend.snapshot();
    expect(
      request('changes.plan', { commands: [command], initiator: 'operator' }),
    ).toMatchObject({ ok: false });
    expect(backend.snapshot()).toEqual(before);
  });

  it('requires confirmation before semester archival and keeps archives read-only', () => {
    success(
      apply(
        plan([
          {
            type: 'semester.create',
            id: 'SEM-NEXT',
            fields: { title: 'Next', startDate: '2027-02-01', weeksCount: 14 },
          },
          { type: 'semester.setCurrent', id: 'SEM-NEXT' },
        ]),
      ),
    );
    const archive = plan([{ type: 'semester.archive', id: 'SEM-2026-FALL' }]);
    expect(archive.confirmationReasons).toContain('SEMESTER_ARCHIVE');
    expect(apply(archive, 'OP-ARCHIVE')).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    success(apply(archive, 'OP-ARCHIVE', true));
    expect(
      request('changes.plan', { commands: [move], initiator: 'operator' }),
    ).toMatchObject({ ok: false, error: { code: 'ARCHIVED' } });
  });

  it('verifies undo of a newly created semester for all affected users', () => {
    success(
      apply(
        plan([
          {
            type: 'semester.create',
            id: 'SEM-NEXT',
            fields: { title: 'Next', startDate: '2027-02-01', weeksCount: 14 },
          },
        ]),
      ),
    );
    const undo = plan([{ type: 'changes.undo', operationId: 'OP-FIRST' }]);
    expect(undo.affectedUsers).toContainEqual({
      user: { id: 'U001', slug: 'ermolz', displayName: 'Ermolz' },
      semesterId: 'SEM-NEXT',
      lessonCount: 0,
    });
    success(apply(undo, 'OP-UNDO'));
    expect(
      success(request('changes.verify', { operationId: 'OP-UNDO' })),
    ).toMatchObject({
      verified: true,
      participants: [{ semesterId: 'SEM-NEXT', matches: true }],
    });
  });

  it('requires bulk confirmation when one course archive hides several lessons', () => {
    const prepared = plan([{ type: 'offering.archive', id: 'OFF-SCRUM-26' }]);
    expect(prepared.confirmationReasons).toContain('BULK_REMOVAL');
    expect(apply(prepared)).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
  });

  it('requires bulk confirmation when undo removes several created records', () => {
    success(
      apply(
        plan([
          {
            type: 'subject.create',
            id: 'SUB-FIRST',
            fields: { name: 'First', shortName: 'First', color: '#aabbcc' },
          },
          {
            type: 'subject.create',
            id: 'SUB-SECOND',
            fields: { name: 'Second', shortName: 'Second', color: '#aabbcc' },
          },
        ]),
      ),
    );
    const undo = plan([{ type: 'changes.undo', operationId: 'OP-FIRST' }]);
    expect(undo.confirmationReasons).toContain('BULK_REMOVAL');
    expect(apply(undo, 'OP-UNDO')).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    success(apply(undo, 'OP-UNDO', true));
  });
});
