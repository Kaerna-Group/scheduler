import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { readAppsScriptSource } from '../scripts/apps-script-sources.mjs';

function fixture(
  options: {
    badHeaders?: boolean;
    maxRows?: number;
    lastRow?: number;
    service?: boolean;
  } = {},
) {
  const batchUpdate = vi.fn();
  const context = vm.createContext({
    Utilities: {
      newBlob: (text: string) => ({ getBytes: () => Buffer.from(text) }),
    },
    ...(options.service === false
      ? {}
      : { Sheets: { Spreadsheets: { batchUpdate } } }),
  });
  vm.runInContext(readAppsScriptSource(), context);
  const headers = vm.runInContext('SCHEDULER_SHEETS.Lessons', context) as string[];
  Object.assign(context, {
    getSchedulerSpreadsheet_: () => ({
      getId: () => 'atomic-test-sheet',
      getSheetByName: (name: string) =>
        name !== 'Lessons'
          ? null
          : {
              getSheetId: () => 7,
              getMaxRows: () => options.maxRows ?? 5,
              getLastRow: () => options.lastRow ?? 5,
              getLastColumn: () => headers.length,
              getRange: () => ({
                getDisplayValues: () => [
                  options.badHeaders ? ['wrong', ...headers.slice(1)] : headers,
                ],
              }),
            },
    }),
  });
  const write = (rows: Array<Record<string, string>>) => {
    context.rows = rows;
    vm.runInContext(
      "writeTablesAtomically_({ Lessons: rows }, ['Lessons'])",
      context,
    );
  };
  return { write, batchUpdate, headers };
}

describe('atomic Sheets request construction', () => {
  it('keeps formulas/times literal, excludes headers and clears stale trailing cells', () => {
    const { write, batchUpdate, headers } = fixture();
    write([
      {
        lesson_id: 'LES-ONE',
        start_time: '08:30',
        teacher: '=IMPORTDATA("https://example.test")',
      },
    ]);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    const [body, spreadsheetId] = batchUpdate.mock.calls[0];
    expect(spreadsheetId).toBe('atomic-test-sheet');
    expect(body.requests).toHaveLength(1);
    const update = body.requests[0].updateCells;
    expect(update.range).toMatchObject({
      sheetId: 7,
      startRowIndex: 1,
      endRowIndex: 5,
      startColumnIndex: 0,
      endColumnIndex: headers.length,
    });
    expect(update.fields).toBe('userEnteredValue');
    expect(update.rows).toHaveLength(1);
    expect(update.rows[0].values[headers.indexOf('teacher')]).toEqual({
      userEnteredValue: { stringValue: '=IMPORTDATA("https://example.test")' },
    });
    expect(update.rows[0].values[headers.indexOf('start_time')]).toEqual({
      userEnteredValue: { stringValue: '08:30' },
    });
  });

  it('grows a full sheet in the same batch before writing new rows', () => {
    const { write, batchUpdate } = fixture();
    write(
      Array.from({ length: 7 }, (_, index) => ({ lesson_id: `LES-${index}` })),
    );
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdate.mock.calls[0][0].requests[0]).toEqual({
      appendDimension: { sheetId: 7, dimension: 'ROWS', length: 3 },
    });
    expect(
      batchUpdate.mock.calls[0][0].requests[1].updateCells.range.endRowIndex,
    ).toBe(8);
  });

  it('handles an empty sheet containing only its header row', () => {
    const { write, batchUpdate } = fixture({ maxRows: 1, lastRow: 1 });
    write([]);
    expect(
      batchUpdate.mock.calls[0][0].requests[0].appendDimension.length,
    ).toBe(1);
    expect(batchUpdate.mock.calls[0][0].requests[1].updateCells.rows).toEqual(
      [],
    );
  });

  it('refuses unexpected headers and oversized requests before touching Sheets', () => {
    const wrong = fixture({ badHeaders: true });
    expect(() => wrong.write([])).toThrow('Unexpected columns');
    expect(wrong.batchUpdate).not.toHaveBeenCalled();
    const large = fixture();
    expect(() => large.write([{ teacher: 'x'.repeat(1800000) }])).toThrow(
      '1.8 MB',
    );
    expect(large.batchUpdate).not.toHaveBeenCalled();
  });

  it('fails closed when Advanced Sheets is not enabled', () => {
    const { write, batchUpdate } = fixture({ service: false });
    expect(() => write([])).toThrow('Enable the Advanced Sheets');
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});
