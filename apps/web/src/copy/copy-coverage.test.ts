// INSTR: a stage error code never reaches the UI raw. Every code in core `STAGE_ERROR_CODES` (the
// worker's `StageError` takes only these) has copy, and the instruction errors name the files.
import { REQUIRED_INSTRUCTION_FILES, STAGE_ERROR_CODES } from '@pra/core';
import { describe, expect, it } from 'vitest';
import { reasonText } from '@/lib/reasons.ts';
import { copy } from './index.ts';

describe('stage error copy', () => {
  it('has words for every stage error code', () => {
    const missing = STAGE_ERROR_CODES.filter((code) => copy.reasons[code] === undefined);
    expect(missing).toEqual([]);
    for (const code of STAGE_ERROR_CODES) {
      expect(reasonText(code, {})).not.toBe(copy.unknownReason(code));
      if (code.includes('_')) expect(reasonText(code, {})).not.toContain(code);
    }
  });

  it('has a name for every stage with required instruction files', () => {
    for (const stage of Object.keys(REQUIRED_INSTRUCTION_FILES)) {
      expect(copy.stages[stage]).toBeDefined();
    }
  });

  it('names the missing instruction files and where to add them', () => {
    expect(reasonText('verifier_instructions_missing', { missing: ['verify-rules.md'] })).toBe(
      'instruction files for Verify: verify-rules.md is missing; add it in Settings → Instructions',
    );
    expect(
      reasonText('instructions_missing', {
        stage: 'verify',
        missing: ['prompt-verifier.md', 'verify-rules.md'],
      }),
    ).toBe(
      'instruction files for Verify: prompt-verifier.md and verify-rules.md are missing; add them in Settings → Instructions',
    );
  });

  it('names the stage’s required files when the error has no params', () => {
    expect(reasonText('implementer_instructions_missing')).toContain(
      'prompt-implementer.md and implement-rules.md are missing',
    );
  });
});
