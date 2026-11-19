/**
 * An integration failed for a known reason. Like core's reasons, it carries a code and params,
 * never prose for people: the api and the web map the code to copy.
 */
export class IntegrationError extends Error {
  readonly code: string;
  readonly params: Record<string, unknown>;

  constructor(code: string, params: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(`${code} ${JSON.stringify(params)}`, options);
    this.name = 'IntegrationError';
    this.code = code;
    this.params = params;
  }
}

/**
 * An integration has no credentials. Thrown before any network call, so a missing key never
 * reaches the outside world. `params.missing` names the env vars (names only, never values).
 */
export class IntegrationNotConfiguredError extends IntegrationError {
  declare readonly params: { missing: string[] };

  constructor(code: string, missing: string[]) {
    super(code, { missing });
    this.name = 'IntegrationNotConfiguredError';
  }
}
