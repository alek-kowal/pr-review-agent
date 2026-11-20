// INSTR: every code a stage can fail with is in core `STAGE_ERROR_CODES` (the web has copy for
// each, apps/web `copy-coverage.test.ts`). Codes the stages write themselves are checked by the
// type of `StageError`; this covers the codes that come from agents and integrations at run time.
import { AGENT_ERROR_CODES } from '@pra/agents';
import { isStageErrorCode, STAGE_ERROR_CODES } from '@pra/core';
import {
  CLICKUP_AUTH_FAILED,
  CLICKUP_ERROR,
  CLICKUP_NOT_CONFIGURED,
  GITHUB_APP_NOT_INSTALLED,
  GITHUB_NOT_CONFIGURED,
  GITHUB_RATE_LIMITED,
  GITHUB_READ_ONLY,
  IntegrationError,
  OPENROUTER_ERROR,
  SANDBOX_CANCELLED,
  SANDBOX_FAILED,
  SANDBOX_NOT_CONFIGURED,
} from '@pra/integrations';
import { describe, expect, it } from 'vitest';
import { errorOf } from '../src/run/execute-stage.ts';
import { GITHUB_ERROR } from '../src/stages/checks.ts';

describe('stage error codes', () => {
  it('lists every agent error code', () => {
    expect(STAGE_ERROR_CODES).toEqual(expect.arrayContaining([...AGENT_ERROR_CODES]));
  });

  it('lists every integration error code a stage can throw', () => {
    const codes = [
      GITHUB_ERROR,
      GITHUB_NOT_CONFIGURED,
      GITHUB_APP_NOT_INSTALLED,
      GITHUB_READ_ONLY,
      GITHUB_RATE_LIMITED,
      CLICKUP_NOT_CONFIGURED,
      CLICKUP_AUTH_FAILED,
      CLICKUP_ERROR,
      SANDBOX_NOT_CONFIGURED,
      SANDBOX_CANCELLED,
      SANDBOX_FAILED,
      ...Object.values(OPENROUTER_ERROR),
    ];
    expect(codes.filter((code) => !isStageErrorCode(code))).toEqual([]);
  });

  it('keeps a listed code a stage threw, with its params', () => {
    expect(errorOf(new IntegrationError(GITHUB_RATE_LIMITED, { resetAt: 'soon' }))).toEqual({
      code: 'github_rate_limited',
      params: { resetAt: 'soon' },
    });
  });

  it('turns an unlisted code into stage_error and keeps the code in params', () => {
    expect(errorOf(new IntegrationError('seed_invalid', { file: 'x.json' }))).toEqual({
      code: 'stage_error',
      params: { file: 'x.json', code: 'seed_invalid' },
    });
    expect(errorOf(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toEqual({
      code: 'stage_error',
      params: {},
    });
  });
});
