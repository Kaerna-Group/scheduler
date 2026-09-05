import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CliError, createControlClient } from './client.ts';
import type { ControlEnvironment } from './client.ts';

const help = {
  commands: [
    'catalog [--semester ID] --json',
    'users find [--query TEXT] --json',
    'enrollments find [--user ID] [--offering ID] --json',
    'lessons find [--semester ID] [--course CODE] [--offering ID] [--lesson ID] [--type lecture|group] [--day DAY] [--start-time HH:mm] --json',
    'changes plan --file change.json [--initiator NAME] --json',
    'changes apply --plan-id ID --operation-id ID [--confirm-plan-id ID] --json',
    'changes verify --operation-id ID --json',
    'history [--limit 25] --json',
  ],
  environment: [
    'SCHEDULER_API_URL',
    'SCHEDULER_INTEGRATION_ID',
    'SCHEDULER_INTEGRATION_TOKEN',
    'SCHEDULER_INITIATOR',
  ],
  note: 'All output is JSON. Save operationId before applying. Review confirmationReasons before providing --confirm-plan-id. Credentials are accepted only from the environment.',
};

export async function runCli(
  args: string[],
  env: ControlEnvironment,
  dependencies: {
    fetch?: typeof fetch;
    readFile?: (path: string) => Promise<string>;
    write?: (text: string) => void;
  } = {},
): Promise<number> {
  const write =
    dependencies.write ?? ((text: string) => process.stdout.write(text + '\n'));
  const emit = (value: unknown) => {
    let text = JSON.stringify(value);
    if (env.SCHEDULER_INTEGRATION_TOKEN)
      text = text.split(env.SCHEDULER_INTEGRATION_TOKEN).join('[REDACTED]');
    write(text);
  };
  try {
    if (
      args.length === 0 ||
      (args.length === 1 && ['help', '--help'].includes(args[0]))
    ) {
      emit({ ok: true, data: help });
      return 0;
    }
    const command =
      args[0] === 'catalog' || args[0] === 'history'
        ? args[0]
        : args.slice(0, 2).join(' ');
    const definitions: Record<string, { action: string; flags: string[] }> = {
      catalog: { action: 'control.catalog', flags: ['semester'] },
      'users find': { action: 'control.users', flags: ['query'] },
      'enrollments find': {
        action: 'control.enrollments.find',
        flags: ['user', 'offering'],
      },
      'lessons find': {
        action: 'control.lessons.find',
        flags: [
          'semester',
          'course',
          'offering',
          'lesson',
          'type',
          'day',
          'start-time',
        ],
      },
      'changes plan': {
        action: 'control.changes.plan',
        flags: ['file', 'initiator'],
      },
      'changes apply': {
        action: 'control.changes.apply',
        flags: ['plan-id', 'operation-id', 'confirm-plan-id'],
      },
      'changes verify': {
        action: 'control.changes.verify',
        flags: ['operation-id'],
      },
      history: { action: 'control.history', flags: ['limit'] },
    };
    const definition = Object.hasOwn(definitions, command)
      ? definitions[command]
      : undefined;
    if (!definition)
      throw new CliError(
        'INVALID_ARGUMENTS',
        'Unknown command. Run scheduler --help.',
      );
    let values: Record<string, string | boolean | undefined>;
    try {
      const options: Record<string, { type: 'string' | 'boolean' }> = {
        json: { type: 'boolean' },
      };
      definition.flags.forEach((flag) => {
        options[flag] = { type: 'string' };
      });
      const parsed = parseArgs({
        args: args.slice(command.includes(' ') ? 2 : 1),
        options,
        strict: true,
        allowPositionals: false,
        tokens: true,
      });
      const names = parsed.tokens
        .filter((token) => token.kind === 'option')
        .map((token) => token.name);
      if (new Set(names).size !== names.length)
        throw new Error('Duplicate flags');
      values = parsed.values;
    } catch {
      throw new CliError(
        'INVALID_ARGUMENTS',
        'Unknown, repeated or malformed arguments. Run scheduler --help.',
      );
    }
    const required = (name: string) => {
      const value = values[name];
      if (typeof value !== 'string' || !value.trim())
        throw new CliError('INVALID_ARGUMENTS', `--${name} is required.`);
      return value;
    };
    let payload: Record<string, unknown> = {};
    if (command === 'changes plan') {
      const path = required('file');
      let document: unknown;
      try {
        const raw = await (
          dependencies.readFile ?? ((file: string) => readFile(file, 'utf8'))
        )(path);
        if (Buffer.byteLength(raw, 'utf8') > 100000)
          throw new Error('Too large');
        document = JSON.parse(raw);
      } catch {
        throw new CliError(
          'INVALID_CHANGE_FILE',
          'The change file must be readable JSON smaller than 100 KB.',
        );
      }
      if (
        !document ||
        typeof document !== 'object' ||
        Array.isArray(document) ||
        Object.keys(document).some(
          (key) => !['commands', 'reason'].includes(key),
        )
      )
        throw new CliError(
          'INVALID_CHANGE_FILE',
          'The change file accepts only commands and an optional reason.',
        );
      const initiator = values.initiator ?? env.SCHEDULER_INITIATOR;
      if (typeof initiator !== 'string' || !initiator.trim())
        throw new CliError(
          'INITIATOR_REQUIRED',
          'Set SCHEDULER_INITIATOR or pass --initiator. This is a caller-reported audit label.',
        );
      payload = { ...document, initiator };
    } else if (command === 'changes apply') {
      payload = {
        planId: required('plan-id'),
        operationId: required('operation-id'),
      };
      if (values['confirm-plan-id'] !== undefined)
        payload.confirmPlanId = required('confirm-plan-id');
    } else if (command === 'changes verify')
      payload.operationId = required('operation-id');
    else if (command === 'lessons find' || command === 'enrollments find') {
      const mapping: Record<string, string> = {
        semester: 'semesterId',
        course: 'course',
        offering: 'offeringId',
        lesson: 'lessonId',
        type: 'type',
        day: 'day',
        'start-time': 'startTime',
        user: 'userId',
      };
      payload.filters = Object.fromEntries(
        definition.flags
          .filter((flag) => values[flag] !== undefined)
          .map((flag) => [mapping[flag], required(flag)]),
      );
    } else if (command === 'catalog' && values.semester !== undefined)
      payload.semesterId = required('semester');
    else if (command === 'users find' && values.query !== undefined)
      payload.query = required('query');
    else if (command === 'history' && values.limit !== undefined) {
      const limit = Number(required('limit'));
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new CliError('INVALID_ARGUMENTS', '--limit must be 1–100.');
      payload.limit = limit;
    }
    const result = await createControlClient(env, dependencies.fetch)(
      definition.action,
      payload,
    );
    emit(result);
    return !result.ok
      ? 1
      : command === 'changes verify' && result.data.verified !== true
        ? 2
        : 0;
  } catch (error) {
    emit({
      ok: false,
      error: {
        code: error instanceof CliError ? error.code : 'CLI_ERROR',
        message:
          error instanceof CliError ? error.message : 'Unexpected CLI error.',
      },
    });
    return 1;
  }
}
