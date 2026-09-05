import { beforeEach, describe, expect, it } from 'vitest';
import { createTestBackend } from './support/apps-script-backend';
import { runCli } from '../cli/run';
import { planInput } from '../mcp/schemas';

let backend: ReturnType<typeof createTestBackend>;
let credentials: { integrationId: string; integrationToken: string };
const scopes = [
  'catalog:read',
  'users:read',
  'catalog:write',
  'history:read',
  'changes:undo',
];
const merge = {
  type: 'subject.merge',
  targetSubjectId: 'SUB-SCRUM',
  sourceSubjectIds: ['SUB-DUPLICATE'],
};
function data(response: unknown): Record<string, unknown> {
  expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
  return (response as { data: Record<string, unknown> }).data;
}
function request(action: string, payload: Record<string, unknown> = {}) {
  return backend.post({
    action: 'control.' + action,
    apiVersion: 1,
    integrationId: credentials.integrationId,
    integrationToken: credentials.integrationToken,
    ...payload,
  });
}
function addDuplicate() {
  const db = backend.snapshot();
  const original = db.Subjects.find((row) => row.subject_id === 'SUB-SCRUM')!;
  db.Subjects.push({
    ...original,
    subject_id: 'SUB-DUPLICATE',
    name: '  SCRUM   Framework Fundamentals  ',
    color: '#123456',
  });
  db.Offerings.push({
    offering_id: 'OFF-DUPLICATE',
    subject_id: 'SUB-DUPLICATE',
    semester_id: 'SEM-2026-FALL',
    external_code: '365095',
    active: 'yes',
  });
  backend.replaceDatabase(db);
  db.Users.push({
    ...db.Users[0],
    user_id: 'USER-SECOND',
    slug: 'second',
    display_name: 'Second user',
    role: 'user',
  });
  db.UserPreferences.push({ ...db.UserPreferences[0], user_id: 'USER-SECOND' });
  db.Groups.push({
    group_id: 'GROUP-DUPLICATE',
    offering_id: 'OFF-DUPLICATE',
    group_number: '3',
    label: 'Group 3',
    active: 'yes',
  });
  db.Enrollments.push({
    enrollment_id: 'ENROLL-DUPLICATE',
    user_id: 'USER-SECOND',
    offering_id: 'OFF-DUPLICATE',
    group_id: 'GROUP-DUPLICATE',
    active: 'yes',
  });
  db.Lessons.push({
    ...db.Lessons.find((row) => row.lesson_id === 'LES-SCRUM-G3')!,
    lesson_id: 'LESSON-DUPLICATE',
    offering_id: 'OFF-DUPLICATE',
  });
  db.LessonGroups.push({
    lesson_id: 'LESSON-DUPLICATE',
    group_id: 'GROUP-DUPLICATE',
  });
  db.LessonWeeks.push({ lesson_id: 'LESSON-DUPLICATE', week: '3' });
  backend.replaceDatabase(db);
  return backend.snapshot();
}
beforeEach(() => {
  backend = createTestBackend();
  backend.setupControl();
  credentials = backend.createIntegration(
    'subject-test',
    scopes,
  ) as typeof credentials;
});

describe('subject card merge', () => {
  it('plans, applies atomically, retries, verifies and undoes without changing lessons, enrollment or accounts', () => {
    const before = addDuplicate();
    const prepared = data(
      request('changes.plan', { commands: [merge], initiator: 'test' }),
    );
    expect(prepared.confirmationReasons).toContain('SUBJECT_MERGE');
    expect(prepared.affectedUsers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.objectContaining({ id: 'USER-SECOND' }),
        }),
      ]),
    );
    expect(backend.snapshot().Subjects).toEqual(before.Subjects);
    expect(
      request('changes.apply', {
        planId: prepared.planId,
        operationId: 'OP-MERGE',
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    const args = {
      planId: prepared.planId,
      operationId: 'OP-MERGE',
      confirmPlanId: prepared.planId,
    };
    const applied = data(request('changes.apply', args));
    expect(data(request('changes.apply', args))).toEqual(applied);
    const after = backend.snapshot();
    expect(after.Subjects).toHaveLength(before.Subjects.length - 1);
    expect(
      after.Subjects.find((row) => row.subject_id === 'SUB-SCRUM'),
    ).toEqual(before.Subjects.find((row) => row.subject_id === 'SUB-SCRUM'));
    expect(
      after.Offerings.find((row) => row.offering_id === 'OFF-DUPLICATE'),
    ).toMatchObject({ subject_id: 'SUB-SCRUM', external_code: '365095' });
    for (const table of [
      'Users',
      'UserPreferences',
      'Lessons',
      'LessonGroups',
      'LessonWeeks',
      'Groups',
      'Enrollments',
    ])
      expect(after[table]).toEqual(before[table]);
    expect(
      data(request('changes.verify', { operationId: 'OP-MERGE' })),
    ).toMatchObject({ verified: true });
    const undo = data(
      request('changes.plan', {
        commands: [{ type: 'changes.undo', operationId: 'OP-MERGE' }],
        initiator: 'test',
      }),
    );
    data(
      request('changes.apply', {
        planId: undo.planId,
        operationId: 'OP-UNDO',
        confirmPlanId: undo.planId,
      }),
    );
    expect(backend.snapshot().Subjects).toEqual(before.Subjects);
    expect(backend.snapshot().Offerings).toEqual(before.Offerings);
  });

  it.each([
    [{ ...merge, sourceSubjectIds: ['SUB-SCRUM'] }, 'VALIDATION_ERROR'],
    [
      { ...merge, sourceSubjectIds: ['SUB-DUPLICATE', 'SUB-DUPLICATE'] },
      'VALIDATION_ERROR',
    ],
    [{ ...merge, sourceSubjectIds: [] }, 'VALIDATION_ERROR'],
    [
      { ...merge, sourceSubjectIds: ['SUB-ELECTRONICS'] },
      'SUBJECT_NAME_MISMATCH',
    ],
    [{ ...merge, sourceSubjectIds: ['SUB-MISSING'] }, 'NOT_FOUND'],
    [{ ...merge, account: { active: false } }, 'VALIDATION_ERROR'],
  ])('rejects unsafe merge %j', (command, code) => {
    const before = addDuplicate();
    expect(
      request('changes.plan', { commands: [command], initiator: 'test' }),
    ).toMatchObject({ ok: false, error: { code } });
    expect(backend.snapshot()).toEqual(before);
  });

  it('rejects archived references and insufficient scope', () => {
    const before = addDuplicate();
    before.Semesters.push({
      semester_id: 'SEM-ARCHIVED',
      title: 'Past',
      start_date: '2025-09-01',
      weeks_count: '14',
      active: 'no',
    });
    before.Offerings.find(
      (row) => row.offering_id === 'OFF-DUPLICATE',
    )!.semester_id = 'SEM-ARCHIVED';
    backend.replaceDatabase(before);
    expect(
      request('changes.plan', { commands: [merge], initiator: 'test' }),
    ).toMatchObject({ ok: false, error: { code: 'ARCHIVED' } });
    credentials = backend.createIntegration('read-only', [
      'catalog:read',
      'users:read',
    ]) as typeof credentials;
    expect(
      request('changes.plan', { commands: [merge], initiator: 'test' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('keeps the whole database unchanged when the merge transaction is rejected', () => {
    addDuplicate();
    const prepared = data(
      request('changes.plan', { commands: [merge], initiator: 'test' }),
    );
    const before = backend.snapshot();
    backend.storage.failWriteFor = 'Offerings';
    expect(
      request('changes.apply', {
        planId: prepared.planId,
        operationId: 'OP-FAIL',
        confirmPlanId: prepared.planId,
      }),
    ).toMatchObject({ ok: false });
    expect(backend.snapshot()).toEqual(before);
  });

  it('supports the merge schema through the real CLI transport', async () => {
    addDuplicate();
    expect(planInput.safeParse({ commands: [merge] }).success).toBe(true);
    const output: string[] = [];
    const exit = await runCli(
      ['changes', 'plan', '--file', 'request.json'],
      {
        SCHEDULER_API_URL: 'https://scheduler.test/exec',
        SCHEDULER_INTEGRATION_ID: credentials.integrationId,
        SCHEDULER_INTEGRATION_TOKEN: credentials.integrationToken,
        SCHEDULER_INITIATOR: 'cli-test',
      },
      {
        fetch: backend.fetch,
        readFile: async () => JSON.stringify({ commands: [merge] }),
        write: (value) => output.push(value),
      },
    );
    expect(exit).toBe(0);
    expect(data(JSON.parse(output[0])).commands).toEqual([merge]);
  });
});

describe('owner subject maintenance', () => {
  it('requires a saved preview, then applies, verifies, retries and safely restores it', () => {
    expect(() => backend.applySubjectDeduplication()).toThrow(
      'previewSchedulerSubjectDeduplication',
    );
    const before = addDuplicate();
    const preview = backend.previewSubjectDeduplication() as { planId: string };
    expect(preview.planId).toBeTruthy();
    expect(backend.snapshot().Subjects).toEqual(before.Subjects);
    const applied = backend.applySubjectDeduplication() as {
      applied: { operationId: string };
      verification: { verified: boolean };
    };
    expect(applied.verification.verified).toBe(true);
    expect(backend.applySubjectDeduplication()).toEqual(applied);
    expect(backend.previewSubjectDeduplication()).toMatchObject({
      noChanges: true,
    });
    backend.previewSubjectDeduplicationUndo();
    expect(backend.applySubjectDeduplication()).toMatchObject({
      verification: { verified: true },
    });
    expect(backend.snapshot().Subjects).toEqual(before.Subjects);
    expect(backend.snapshot().Offerings).toEqual(before.Offerings);
    expect(request('history')).toMatchObject({
      ok: true,
      data: { operations: [] },
    });
  });

  it('rejects stale previews and prevents owner identity impersonation over HTTP', () => {
    addDuplicate();
    const preview = backend.previewSubjectDeduplication() as { planId: string };
    const db = backend.snapshot();
    db.Subjects.find((row) => row.subject_id === 'SUB-SCRUM')!.color =
      '#999999';
    backend.replaceDatabase(db);
    expect(() => backend.applySubjectDeduplication()).toThrow(
      'database changed',
    );
    expect(
      request('changes.apply', {
        planId: preview.planId,
        operationId: 'OP-STEAL',
        confirmPlanId: preview.planId,
      }),
    ).toMatchObject({ ok: false, error: { code: 'PLAN_NOT_FOUND' } });
    expect(() =>
      backend.createIntegration('owner:subject-maintenance', scopes),
    ).toThrow('integrationId');
    expect(
      backend.post({
        action: 'control.changes.apply',
        integrationId: 'owner:subject-maintenance',
        integrationToken: 'x'.repeat(40),
        planId: preview.planId,
        operationId: 'OP-STEAL',
      }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });
});

describe('import duplicate prevention', () => {
  function importRequest(code: string, name: string) {
    return {
      action: 'importSchedule',
      userSlug: 'ermolz',
      editToken: backend.token,
      baseRevision: Number(
        backend.snapshot().Meta.find((row) => row.key === 'data_revision')!
          .value,
      ),
      importMode: 'merge',
      payload: {
        schemaVersion: 1,
        semesterId: 'SEM-2026-FALL',
        subjects: [{ externalCode: code, name, selectedGroup: 1, lessons: [] }],
      },
    };
  }
  it('reuses one subject card for another course code in the same semester and preserves its display metadata', () => {
    const before = backend.snapshot();
    data(
      backend.post(
        importRequest('365095', '  SCRUM   Framework Fundamentals  '),
      ),
    );
    const after = backend.snapshot();
    expect(after.Subjects).toEqual(before.Subjects);
    expect(
      after.Offerings.find((row) => row.external_code === '365095'),
    ).toMatchObject({ subject_id: 'SUB-SCRUM' });
    expect(
      after.Offerings.find((row) => row.external_code === '565095'),
    ).toEqual(before.Offerings.find((row) => row.external_code === '565095'));
    data(backend.post(importRequest('365095', 'Scrum Framework Fundamentals')));
    expect(backend.snapshot().Subjects).toEqual(before.Subjects);
  });
  it('refuses ambiguous existing cards without writing any table', () => {
    const before = addDuplicate();
    expect(
      backend.post(importRequest('NEW-SCRUM', 'Scrum Framework Fundamentals')),
    ).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_SUBJECT' } });
    expect(backend.snapshot()).toEqual(before);
  });
  it('still creates a distinct subject for a genuinely different name', () => {
    const before = backend.snapshot();
    data(backend.post(importRequest('NEW-COURSE', 'Different course')));
    expect(backend.snapshot().Subjects).toHaveLength(
      before.Subjects.length + 1,
    );
  });
});
