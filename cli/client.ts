export interface ControlEnvironment {
  SCHEDULER_API_URL?: string;
  SCHEDULER_INTEGRATION_ID?: string;
  SCHEDULER_INTEGRATION_TOKEN?: string;
  SCHEDULER_INITIATOR?: string;
}

export type ControlEnvelope =
  | { apiVersion: 1; ok: true; data: Record<string, unknown> }
  | {
      apiVersion: 1;
      ok: false;
      error: { code: string; message: string; details?: unknown };
      revision?: number;
    };

export class CliError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function createControlClient(
  env: ControlEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const {
    SCHEDULER_API_URL: endpoint,
    SCHEDULER_INTEGRATION_ID: integrationId,
    SCHEDULER_INTEGRATION_TOKEN: integrationToken,
  } = env;
  if (!endpoint || !integrationId || !integrationToken)
    throw new CliError(
      'CONFIGURATION_REQUIRED',
      'Set SCHEDULER_API_URL, SCHEDULER_INTEGRATION_ID and SCHEDULER_INTEGRATION_TOKEN in the environment.',
    );
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new CliError(
      'INVALID_ENDPOINT',
      'SCHEDULER_API_URL must be an HTTPS URL.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new CliError(
      'INVALID_ENDPOINT',
      'Use an HTTPS endpoint without credentials, query parameters or fragments.',
    );

  return async (
    action: string,
    payload: Record<string, unknown>,
  ): Promise<ControlEnvelope> => {
    let response: Response;
    try {
      const signal = AbortSignal.timeout(60000);
      response = await fetcher(url, {
        method: 'POST',
        redirect: 'manual',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          apiVersion: 1,
          action,
          integrationId,
          integrationToken,
        }),
      });
      // Apps Script serves ContentService results using a one-time GET redirect.
      // Never forward the POST body or credential to a redirected host.
      if ([301, 302, 303].includes(response.status)) {
        const location = response.headers.get('location');
        const target = location ? new URL(location, url) : null;
        if (
          !target ||
          target.protocol !== 'https:' ||
          target.hostname !== 'script.googleusercontent.com' ||
          target.username ||
          target.password
        )
          throw new CliError(
            'UNEXPECTED_REDIRECT',
            'The API returned an unexpected response redirect.',
          );
        response = await fetcher(target, {
          method: 'GET',
          redirect: 'error',
          signal,
        });
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(
        'REQUEST_FAILED',
        'The API request timed out or failed. An apply may already have committed; retry the same planId and operationId, then verify.',
      );
    }
    if (!response.ok)
      throw new CliError(
        'HTTP_ERROR',
        `The API returned HTTP ${response.status}. An apply may have committed; retain its operationId.`,
      );
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new CliError(
        'INVALID_RESPONSE',
        'The API did not return JSON. Check the deployment URL and access settings. Retain the operationId if applying.',
      );
    }
    if (
      !result ||
      typeof result !== 'object' ||
      !('apiVersion' in result) ||
      result.apiVersion !== 1
    )
      throw new CliError(
        'API_VERSION_MISMATCH',
        'This CLI requires a backend using API version 1.',
      );
    const envelope = result as Record<string, unknown>;
    if (
      envelope.ok === true &&
      envelope.data &&
      typeof envelope.data === 'object' &&
      !Array.isArray(envelope.data)
    )
      return result as ControlEnvelope;
    if (
      envelope.ok === false &&
      envelope.error &&
      typeof envelope.error === 'object' &&
      'code' in envelope.error &&
      typeof envelope.error.code === 'string' &&
      'message' in envelope.error &&
      typeof envelope.error.message === 'string'
    )
      return result as ControlEnvelope;
    throw new CliError(
      'INVALID_RESPONSE',
      'The API returned an invalid response envelope.',
    );
  };
}
