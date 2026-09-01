const API_URL = (import.meta.env.VITE_SCHEDULE_API_URL as string | undefined)?.trim() ?? '';

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  revision?: number;
}

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

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

export function hasRemoteApi() {
  return Boolean(API_URL);
}

export function createApiUrl() {
  if (!API_URL) throw new Error('Remote API ще не налаштовано.');
  return new URL(API_URL);
}

export function parseApiResponse<T>(value: unknown): T {
  const response = value as ApiResponse<T>;
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    throw new Error('Сервер повернув невідомий формат відповіді.');
  }
  if (!response.ok) throw new ApiError(response);
  return response.data;
}

export async function postApi<T>(body: Record<string, unknown>) {
  const response = await fetch(createApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`API недоступне: HTTP ${response.status}.`);
  return parseApiResponse<T>(await response.json());
}
