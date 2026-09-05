import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../cli/run';
import { createControlClient } from '../cli/client';
import { createTestBackend } from './support/apps-script-backend';

const scopes = [
  'catalog:read',
  'users:read',
  'lessons:write',
  'catalog:write',
  'enrollments:write',
  'history:read',
  'changes:undo',
];
function fixture() {
  const backend = createTestBackend();
  backend.setupControl();
  const credentials = backend.createIntegration('cli-test', scopes) as {
    integrationId: string;
    integrationToken: string;
  };
  const env = {
    SCHEDULER_API_URL: 'https://scheduler.test/exec',
    SCHEDULER_INTEGRATION_ID: credentials.integrationId,
    SCHEDULER_INTEGRATION_TOKEN: credentials.integrationToken,
    SCHEDULER_INITIATOR: 'local operator',
  };
  const commands = [
    {
      type: 'lesson.move',
      lessonId: 'LES-SCRUM-LECTURE',
      fromWeek: 3,
      startTime: '17:00',
    },
  ];
  async function run(args: string[], overrides = {}) {
    const output: string[] = [];
    const code = await runCli(args, env, {
      fetch: backend.fetch,
      readFile: async () => JSON.stringify({ commands }),
      write: (text) => output.push(text),
      ...overrides,
    });
    expect(output).toHaveLength(1);
    expect(output[0]).not.toContain(credentials.integrationToken);
    return { code, result: JSON.parse(output[0]), output: output[0] };
  }
  return { backend, env, commands, run };
}

describe('Scheduler CLI against the real isolated Apps Script backend', () => {
  it('completes find → plan → apply → verify with JSON and stable IDs', async () => {
    const { backend, run } = fixture();
    const found = await run([
      'lessons',
      'find',
      '--course',
      '565095',
      '--type',
      'lecture',
      '--json',
    ]);
    expect(found.code).toBe(0);
    expect(found.result.data.lessons[0].lessonId).toBe('LES-SCRUM-LECTURE');
    const planned = await run([
      'changes',
      'plan',
      '--file',
      'move.json',
      '--json',
    ]);
    expect(planned.code).toBe(0);
    const planId = planned.result.data.planId;
    const applied = await run([
      'changes',
      'apply',
      '--plan-id',
      planId,
      '--operation-id',
      'OP-CLI',
      '--json',
    ]);
    expect(applied.code).toBe(0);
    expect(backend.calls.at(-1)?.body).toMatchObject({
      action: 'control.changes.apply',
      planId,
      operationId: 'OP-CLI',
    });
    const verified = await run([
      'changes',
      'verify',
      '--operation-id',
      'OP-CLI',
      '--json',
    ]);
    expect(verified.code).toBe(0);
    expect(verified.result.data.verified).toBe(true);
    expect(
      (await run(['history', '--limit', '1'])).result.data.operations[0]
        .operationId,
    ).toBe('OP-CLI');
    expect(
      (
        await run([
          'enrollments',
          'find',
          '--user',
          'U001',
          '--offering',
          'OFF-SCRUM-26',
        ])
      ).result.data.enrollments,
    ).toHaveLength(1);
  });

  it('uses distinct nonzero exits for server errors and divergent verification', async () => {
    const { backend, run } = fixture();
    const prepared = await run(['changes', 'plan', '--file', 'change.json']);
    const planId = prepared.result.data.planId;
    await run([
      'changes',
      'apply',
      '--plan-id',
      planId,
      '--operation-id',
      'OP-CLI',
    ]);
    const data = backend.snapshot();
    data.Lessons.at(-1)!.start_time = '17:05';
    backend.replaceDatabase(data);
    expect(
      (await run(['changes', 'verify', '--operation-id', 'OP-CLI'])).code,
    ).toBe(2);
    expect(
      (
        await run([
          'changes',
          'apply',
          '--plan-id',
          planId,
          '--operation-id',
          'OP-OTHER',
        ])
      ).code,
    ).toBe(1);
  });

  it.each([
    ['changes', 'apply', '--plan-id', 'PLAN-ONE'],
    ['lessons', 'find', '--token', 'should-never-echo'],
    [
      'changes',
      'apply',
      '--plan-id',
      'PLAN-ONE',
      '--plan-id',
      'PLAN-TWO',
      '--operation-id',
      'OP-ONE',
    ],
    ['catalog', 'unexpected'],
    ['history', '--limit', 'NaN'],
    ['unknown'],
  ])(
    'rejects malformed arguments without making a request: %j',
    async (...args) => {
      const { backend, run } = fixture();
      const result = await run(args as string[]);
      expect(result.code).toBe(1);
      expect(result.output).not.toContain('should-never-echo');
      expect(backend.calls).toEqual([]);
    },
  );

  it('rejects credentials and transport fields in a change file', async () => {
    const { backend, run, commands } = fixture();
    const result = await run(['changes', 'plan', '--file', 'bad.json'], {
      readFile: async () =>
        JSON.stringify({
          commands,
          action: 'adminCreateUser',
          integrationToken: 'other',
        }),
    });
    expect(result.result.error.code).toBe('INVALID_CHANGE_FILE');
    expect(backend.calls).toEqual([]);
  });

  it('never retries apply automatically or invents another operation ID', async () => {
    const { run } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('network error containing a secret'));
    const result = await run(
      ['changes', 'apply', '--plan-id', 'PLAN-ONE', '--operation-id', 'OP-ONE'],
      { fetch: fetcher },
    );
    expect(result.code).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.result.error.message).toContain(
      'same planId and operationId',
    );
    expect(result.output).not.toContain('network error containing a secret');
  });
});

describe('control transport', () => {
  it('follows only the Apps Script content redirect as a credential-free GET', async () => {
    const { env } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              'https://script.googleusercontent.com/macros/echo?key=response',
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ apiVersion: 1, ok: true, data: { users: [] } }),
      );
    await expect(
      createControlClient(env, fetcher)('control.users', {}),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher.mock.calls[0][1]?.body).toContain(
      env.SCHEDULER_INTEGRATION_TOKEN,
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
    });
    expect(fetcher.mock.calls[1][1]?.body).toBeUndefined();
    expect(fetcher.mock.calls[1][1]?.headers).toBeUndefined();
  });

  it('refuses cross-host POST redirects and incompatible API responses', async () => {
    const { env } = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://unexpected.test/steal' },
        }),
      );
    await expect(
      createControlClient(env, fetcher)('control.users', {}),
    ).rejects.toMatchObject({ code: 'UNEXPECTED_REDIRECT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, data: {} }));
    await expect(
      createControlClient(env, fetcher)('control.users', {}),
    ).rejects.toMatchObject({ code: 'API_VERSION_MISMATCH' });
  });

  it('offers JSON help without secrets or configuration', async () => {
    const output: string[] = [];
    expect(
      await runCli(['--help'], {}, { write: (text) => output.push(text) }),
    ).toBe(0);
    expect(JSON.parse(output[0]).data.commands).toContain(
      'changes verify --operation-id ID --json',
    );
  });
});
