const API_URL =
  (import.meta.env.VITE_SCHEDULE_API_URL as string | undefined)?.trim() ?? '';

// API contract version, independent of import schemaVersion and Sheets schema_version.
export const API_VERSION = 1;

interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  revision?: number;
}

const COMPATIBILITY_CODES = new Set([
  'API_VERSION_MISSING',
  'API_VERSION_MISMATCH',
  'INVALID_API_RESPONSE',
]);

// These operations do not mutate data. All other POST actions, including future
// ones, must pass an uncached health check before credentials/drafts are sent.
const READ_ONLY_POST_ACTIONS = new Set([
  'adminOverview',
  'adminUserDetails',
  'adminAuditLog',
  'previewImport',
]);

export class ApiError extends Error {
  code: string;
  details?: unknown;
  revision?: number;

  constructor(response: ApiFailure) {
    super(response.error.message);
    this.name = 'ApiError';
    this.code = response.error.code;
    this.details = response.error.details;
    this.revision = response.revision;
  }
}

export function isApiCompatibilityError(error: unknown): error is ApiError {
  return error instanceof ApiError && COMPATIBILITY_CODES.has(error.code);
}

function protocolError(code: string, message: string, details?: unknown) {
  return new ApiError({ ok: false, error: { code, message, details } });
}

function invalidResponse() {
  return protocolError(
    'INVALID_API_RESPONSE',
    'The backend returned an unsupported response format. Check the Apps Script web-app URL (/exec) and publish the current backend.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertCompatibleVersion(version: unknown) {
  if (version === undefined) {
    throw protocolError(
      'API_VERSION_MISSING',
      `This Apps Script backend is too old: it does not report apiVersion. Publish the latest backend (API v${API_VERSION}) before continuing.`,
    );
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw invalidResponse();
  if (version !== API_VERSION) {
    throw protocolError(
      'API_VERSION_MISMATCH',
      version < API_VERSION
        ? `This Apps Script backend uses an older API (v${version}). Publish the latest backend; this site requires API v${API_VERSION}.`
        : `The backend API (v${version}) is newer than this site supports (v${API_VERSION}). Reload the site or update the frontend before continuing.`,
      { serverApiVersion: version, clientApiVersion: API_VERSION },
    );
  }
}

export function hasRemoteApi() {
  return Boolean(API_URL);
}

export function createApiUrl() {
  if (!API_URL) throw new Error('The remote API is not configured yet.');
  const url = new URL(API_URL);
  url.searchParams.set('apiVersion', String(API_VERSION));
  return url;
}

export function parseApiResponse<T>(value: unknown): T {
  if (!isRecord(value) || typeof value.ok !== 'boolean')
    throw invalidResponse();
  assertCompatibleVersion(value.apiVersion);
  if (!value.ok) {
    if (
      !isRecord(value.error) ||
      typeof value.error.code !== 'string' ||
      typeof value.error.message !== 'string'
    )
      throw invalidResponse();
    throw new ApiError({
      ok: false,
      error: {
        code: value.error.code,
        message: value.error.message,
        details: value.error.details,
      },
      revision: typeof value.revision === 'number' ? value.revision : undefined,
    });
  }
  if (!Object.hasOwn(value, 'data')) throw invalidResponse();
  return value.data as T;
}

async function readApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new Error(`The API is unavailable: HTTP ${response.status}.`);
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw invalidResponse();
    throw error; // Preserve cancellation and interrupted network reads.
  }
  return parseApiResponse<T>(value);
}

function requestSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function getApi<T>(
  parameters: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = createApiUrl();
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  url.searchParams.set('apiVersion', String(API_VERSION));
  return readApiResponse<T>(
    await fetch(url, { cache: 'no-store', signal: requestSignal(signal) }),
  );
}

export interface ApiHealth {
  apiVersion: number;
  status: 'ok';
  revision: number;
  schemaVersion: string | null;
  expectedSchemaVersion: string;
  sheets: string[];
}

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealth> {
  const health = await getApi<unknown>({ action: 'health' }, signal);
  if (!isRecord(health)) throw invalidResponse();
  assertCompatibleVersion(health.apiVersion);
  if (
    health.status !== 'ok' ||
    typeof health.revision !== 'number' ||
    !(
      typeof health.schemaVersion === 'string' || health.schemaVersion === null
    ) ||
    typeof health.expectedSchemaVersion !== 'string' ||
    !Array.isArray(health.sheets) ||
    !health.sheets.every((name: unknown) => typeof name === 'string')
  )
    throw invalidResponse();
  return health as unknown as ApiHealth;
}

export async function postApi<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  if (
    typeof body.action !== 'string' ||
    !READ_ONLY_POST_ACTIONS.has(body.action)
  ) {
    await getApiHealth(boundedSignal);
    boundedSignal.throwIfAborted();
  }
  const response = await fetch(createApiUrl(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, apiVersion: API_VERSION }),
    signal: boundedSignal,
  });
  return readApiResponse<T>(response);
}
