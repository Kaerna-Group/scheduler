import { join } from 'node:path';
import ts from 'typescript';
import type {
  ImportPlanResponse,
  ImportSharedConflict,
  ScheduleImportV1,
  UserSchedule,
} from '@/lib/schedule/types';

interface Contracts {
  UserSchedule: UserSchedule;
  ImportPlanResponse: ImportPlanResponse;
  ImportSharedConflict: ImportSharedConflict;
  ScheduleImportV1: ScheduleImportV1;
}

// Test-only runtime inspection of the actual frontend declarations. A generic
// fetch<T>() cast or a second handwritten DTO schema cannot detect type drift.
// Do not import this compiler-based helper into application code.
const root = process.cwd();
const config = ts.readConfigFile(join(root, 'tsconfig.json'), (path) =>
  ts.sys.readFile(path),
);
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
  );
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const sourcePath = join(root, 'lib/schedule/types.ts');
const program = ts.createProgram([sourcePath], {
  ...parsed.options,
  incremental: false,
});
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
}
const checker = program.getTypeChecker();
const source = program.getSourceFile(sourcePath);
const moduleSymbol = source && checker.getSymbolAtLocation(source);
if (!moduleSymbol) throw new Error('Cannot resolve the frontend DTO module');
const exports = checker.getExportsOfModule(moduleSymbol);

function inspect(value: unknown, type: ts.Type, path: string): string[] {
  const mismatch = () => [`${path}: expected ${checker.typeToString(type)}`];
  if (type.flags & ts.TypeFlags.Any)
    throw new Error(`${path}: any would disable contract checking`);
  if (type.flags & ts.TypeFlags.Unknown) return [];
  if (type.isUnion()) {
    return type.types.some(
      (member) => inspect(value, member, path).length === 0,
    )
      ? []
      : mismatch();
  }
  if (type.isStringLiteral() || type.isNumberLiteral())
    return value === type.value ? [] : mismatch();
  if (type.flags & ts.TypeFlags.BooleanLiteral)
    return value === (checker.typeToString(type) === 'true') ? [] : mismatch();
  if (type.flags & ts.TypeFlags.String)
    return typeof value === 'string' ? [] : mismatch();
  if (type.flags & ts.TypeFlags.Number)
    return typeof value === 'number' && Number.isFinite(value)
      ? []
      : mismatch();
  if (type.flags & ts.TypeFlags.Boolean)
    return typeof value === 'boolean' ? [] : mismatch();
  if (type.flags & ts.TypeFlags.Undefined)
    return value === undefined ? [] : mismatch();
  if (type.flags & ts.TypeFlags.Null) return value === null ? [] : mismatch();
  if (checker.isArrayType(type)) {
    if (!Array.isArray(value)) return mismatch();
    const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    if (!element) throw new Error(`${path}: cannot resolve array element type`);
    return value.flatMap((item, index) =>
      inspect(item, element, `${path}[${index}]`),
    );
  }
  if (type.flags & ts.TypeFlags.Object) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return mismatch();
    const record = value as Record<string, unknown>;
    const properties = checker.getPropertiesOfType(type);
    if (
      checker.getSignaturesOfType(type, ts.SignatureKind.Call).length ||
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length ||
      checker.isTupleType(type) ||
      checker.getIndexTypeOfType(type, ts.IndexKind.String)
    ) {
      throw new Error(
        `${path}: unsupported DTO object type ${checker.typeToString(type)}`,
      );
    }
    // Extra fields are intentionally allowed: TypeScript structural compatibility
    // and API v1 both permit additive backend fields.
    return properties.flatMap((property) => {
      const key = property.getName();
      if (!Object.hasOwn(record, key)) {
        return property.flags & ts.SymbolFlags.Optional
          ? []
          : [`${path}.${key}: required field is missing`];
      }
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration)
        throw new Error(`${path}.${key}: cannot resolve property declaration`);
      return inspect(
        record[key],
        checker.getTypeOfSymbolAtLocation(property, declaration),
        `${path}.${key}`,
      );
    });
  }
  throw new Error(
    `${path}: unsupported DTO type ${checker.typeToString(type)}`,
  );
}

export function contractIssues(
  name: keyof Contracts,
  value: unknown,
): string[] {
  const symbol = exports.find((entry) => entry.getName() === name);
  if (!symbol) throw new Error(`Frontend DTO ${name} is not exported`);
  return inspect(value, checker.getDeclaredTypeOfSymbol(symbol), name);
}

export function assertContract<Name extends keyof Contracts>(
  name: Name,
  value: unknown,
): asserts value is Contracts[Name] {
  const issues = contractIssues(name, value);
  if (issues.length)
    throw new Error(`Frontend contract mismatch:\n${issues.join('\n')}`);
}
