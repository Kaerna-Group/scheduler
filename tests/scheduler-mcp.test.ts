import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createSchedulerMcpServer } from '../mcp/server';
import { createTestBackend } from './support/apps-script-backend';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const scopes = [
  'catalog:read',
  'users:read',
  'lessons:write',
  'catalog:write',
  'enrollments:write',
  'history:read',
  'changes:undo',
];
const commands = [
  {
    type: 'lesson.move',
    lessonId: 'LES-SCRUM-LECTURE',
    startTime: '17:00',
    fromWeek: 3,
  },
];

async function fixture(
  options: {
    fetch?: typeof fetch;
    scopes?: string[];
    mode?: 'legacy' | 'auto';
    initiator?: string;
  } = {},
) {
  const backend = createTestBackend();
  backend.setupControl();
  const credentials = backend.createIntegration(
    'mcp-test',
    options.scopes ?? scopes,
  ) as { integrationId: string; integrationToken: string };
  const env = {
    SCHEDULER_API_URL: 'https://scheduler.test/exec',
    SCHEDULER_INTEGRATION_ID: credentials.integrationId,
    SCHEDULER_INTEGRATION_TOKEN: credentials.integrationToken,
    SCHEDULER_INITIATOR: options.initiator ?? 'MCP test operator',
  };
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const handle = serveStdio(
    () =>
      createSchedulerMcpServer(env, { fetch: options.fetch ?? backend.fetch }),
    { transport: serverTransport },
  );
  cleanup.push(() => handle.close());
  const client = new Client(
    { name: 'scheduler-test-client', version: '1.0.0' },
    { versionNegotiation: { mode: options.mode ?? 'legacy' } },
  );
  cleanup.push(() => client.close());
  await client.connect(clientTransport);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.find((item) => item.type === 'text');
    if (!text || text.type !== 'text')
      throw new Error('Missing JSON tool result');
    expect(JSON.stringify(result)).not.toContain(
      env.SCHEDULER_INTEGRATION_TOKEN,
    );
    const envelope = JSON.parse(text.text);
    expect(result.structuredContent).toEqual(envelope);
    return { ...result, envelope };
  }
  return { backend, client, env, call };
}

describe('MCP protocol and Apps Script integration', () => {
  it.each(['legacy', 'auto'] as const)(
    'advertises typed tools and honest annotations for %s clients',
    async (mode) => {
      const { client, env } = await fixture({ mode });
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [
          'scheduler_catalog',
          'scheduler_users_find',
          'scheduler_enrollments_find',
          'scheduler_lessons_find',
          'scheduler_changes_plan',
          'scheduler_changes_apply',
          'scheduler_changes_verify',
          'scheduler_history',
          'scheduler_changes_undo_plan',
        ].sort(),
      );
      const plan = tools.find(
        (tool) => tool.name === 'scheduler_changes_plan',
      )!;
      expect(plan.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
      expect(
        tools.find((tool) => tool.name === 'scheduler_changes_apply')!
          .annotations,
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
      expect(
        tools.find((tool) => tool.name === 'scheduler_lessons_find')!
          .annotations?.readOnlyHint,
      ).toBe(true);
      expect(plan.inputSchema.additionalProperties).toBe(false);
      expect(JSON.stringify(tools)).not.toContain(
        env.SCHEDULER_INTEGRATION_TOKEN,
      );
      expect(JSON.stringify(plan.inputSchema)).not.toMatch(
        /integrationToken|editToken|writeTable|script.execute/,
      );
    },
  );

  it('finds, plans, applies, verifies, inspects history and safely undoes via real tool calls', async () => {
    const { backend, call } = await fixture();
    const originalUsers = backend.snapshot().Users;
    const found = await call('scheduler_lessons_find', {
      course: '565095',
      type: 'lecture',
    });
    expect(found.envelope.data.lessons[0].lessonId).toBe('LES-SCRUM-LECTURE');
    const planned = await call('scheduler_changes_plan', { commands });
    expect(planned.isError).toBe(false);
    const planId = planned.envelope.data.planId;
    expect(backend.calls.at(-1)?.body.initiator).toBe('MCP test operator');
    expect(backend.snapshot().ControlOperations).toEqual([]);
    const applied = await call('scheduler_changes_apply', {
      planId,
      operationId: 'OP-MCP',
    });
    expect(applied.isError).toBe(false);
    const checked = await call('scheduler_changes_verify', {
      operationId: 'OP-MCP',
    });
    expect(checked.envelope.data).toMatchObject({
      verified: true,
      checks: { plannedStateMatches: true, participantSchedulesMatch: true },
    });
    expect(
      (await call('scheduler_history', { limit: 1 })).envelope.data
        .operations[0].operationId,
    ).toBe('OP-MCP');
    expect(
      (await call('scheduler_users_find', { query: 'Ermolz' })).envelope.data
        .users,
    ).toEqual([{ id: 'U001', slug: 'ermolz', displayName: 'Ermolz' }]);
    expect(
      (
        await call('scheduler_enrollments_find', {
          userId: 'U001',
          offeringId: 'OFF-SCRUM-26',
        })
      ).envelope.data.enrollments,
    ).toHaveLength(1);
    const undo = await call('scheduler_changes_undo_plan', {
      operationId: 'OP-MCP',
    });
    expect(backend.snapshot().ControlOperations).toHaveLength(1);
    const undoPlanId = undo.envelope.data.planId;
    expect(
      (
        await call('scheduler_changes_apply', {
          planId: undoPlanId,
          operationId: 'OP-UNDO',
          confirmPlanId: undoPlanId,
        })
      ).isError,
    ).toBe(false);
    expect(
      (await call('scheduler_changes_verify', { operationId: 'OP-UNDO' }))
        .envelope.data.verified,
    ).toBe(true);
    expect(backend.snapshot().Users).toEqual(originalUsers);
  });

  it('does not manufacture conflict confirmation or replay an uncertain write automatically', async () => {
    const { backend, call } = await fixture();
    const planned = await call('scheduler_changes_plan', {
      commands: [{ ...commands[0], startTime: '13:30' }],
    });
    const planId = planned.envelope.data.planId;
    expect(planned.envelope.data.requiresConfirmation).toBe(true);
    const rejected = await call('scheduler_changes_apply', {
      planId,
      operationId: 'OP-MCP',
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.envelope.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(backend.snapshot().ControlOperations).toEqual([]);
    backend.storage.loseBatchResponse = true;
    const uncertain = await call('scheduler_changes_apply', {
      planId,
      operationId: 'OP-MCP',
      confirmPlanId: planId,
    });
    expect(uncertain.isError).toBe(true);
    const calls = backend.calls.filter(
      (entry) => entry.action === 'control.changes.apply',
    );
    expect(calls).toHaveLength(2);
    expect(backend.snapshot().ControlOperations).toHaveLength(1);
    backend.storage.loseBatchResponse = false;
    const replay = await call('scheduler_changes_apply', {
      planId,
      operationId: 'OP-MCP',
      confirmPlanId: planId,
    });
    expect(replay.isError).toBe(false);
    expect(backend.snapshot().ControlOperations).toHaveLength(1);
  });

  it('surfaces stale plans and verification divergence as tool errors', async () => {
    const { backend, call } = await fixture();
    const { envelope } = await call('scheduler_changes_plan', { commands });
    await call('scheduler_changes_apply', {
      planId: envelope.data.planId,
      operationId: 'OP-MCP',
    });
    const next = await call('scheduler_changes_plan', {
      commands: [
        {
          type: 'lesson.update',
          lessonId: 'LES-SCRUM-G1',
          fields: { room: 'Updated' },
        },
      ],
    });
    const data = backend.snapshot();
    data.Lessons.at(-1)!.start_time = '17:05';
    backend.replaceDatabase(data);
    expect(
      (
        await call('scheduler_changes_apply', {
          planId: next.envelope.data.planId,
          operationId: 'OP-NEXT',
        })
      ).envelope.error.code,
    ).toBe('STALE_DATA');
    const verified = await call('scheduler_changes_verify', {
      operationId: 'OP-MCP',
    });
    expect(verified.isError).toBe(true);
    expect(verified.envelope.data.verified).toBe(false);
  });

  it.each([
    { commands: [{ type: 'user.create' }] },
    { commands: [{ type: 'writeTable', table: 'Users' }] },
    { commands, integrationToken: 'injected' },
    { commands, initiator: 'impersonated operator' },
    {
      commands: [
        {
          type: 'lesson.update',
          lessonId: 'LES-SCRUM-LECTURE',
          fields: { edit_token_hash: 'injected' },
        },
      ],
    },
  ])(
    'rejects forbidden tool arguments before calling the backend: %j',
    async (args) => {
      const { client, backend } = await fixture();
      const result = await client
        .callTool({ name: 'scheduler_changes_plan', arguments: args })
        .catch(() => null);
      if (result) expect(result.isError).toBe(true);
      expect(backend.calls).toEqual([]);
    },
  );

  it('enforces backend scopes and revocation even for valid MCP inputs', async () => {
    const limited = await fixture({ scopes: ['catalog:read', 'users:read'] });
    expect((await limited.call('scheduler_catalog')).isError).toBe(false);
    expect(
      (await limited.call('scheduler_changes_plan', { commands })).envelope
        .error.code,
    ).toBe('FORBIDDEN');
    limited.backend.revokeIntegration('mcp-test');
    expect((await limited.call('scheduler_catalog')).envelope.error.code).toBe(
      'UNAUTHORIZED',
    );
  });

  it('does not expose transport exceptions or backend-reflected credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { call, env } = await fixture({ fetch: fetcher });
    fetcher.mockRejectedValueOnce(new Error(env.SCHEDULER_INTEGRATION_TOKEN));
    const failed = await call('scheduler_catalog');
    expect(failed.envelope.error.code).toBe('REQUEST_FAILED');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(
      Response.json({
        apiVersion: 1,
        ok: true,
        data: { reflected: env.SCHEDULER_INTEGRATION_TOKEN },
      }),
    );
    expect((await call('scheduler_catalog')).envelope.data.reflected).toBe(
      '[REDACTED]',
    );
  });

  it('requires the configured audit initiator before planning', async () => {
    const { call, backend } = await fixture({ initiator: '' });
    expect(
      (await call('scheduler_changes_plan', { commands })).envelope.error.code,
    ).toBe('INITIATOR_REQUIRED');
    expect(backend.calls).toEqual([]);
  });
});

describe('actual stdio executable', () => {
  it.each(['legacy', 'auto'] as const)(
    'starts from another working directory and serves %s without stdout chatter',
    async (mode) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL('../scripts/scheduler-mcp.mjs', import.meta.url),
          ),
        ],
        cwd: tmpdir(),
        env: {},
        stderr: 'pipe',
      });
      const errors: string[] = [];
      transport.stderr?.on('data', (chunk: Buffer) =>
        errors.push(chunk.toString()),
      );
      const client = new Client(
        { name: 'scheduler-stdio-test', version: '1.0.0' },
        { versionNegotiation: { mode } },
      );
      cleanup.push(() => client.close());
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(9);
      const result = await client.callTool({
        name: 'scheduler_catalog',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CONFIGURATION_REQUIRED' },
      });
      await client.close();
      expect(errors.join('')).toBe('');
    },
    15000,
  );
});
