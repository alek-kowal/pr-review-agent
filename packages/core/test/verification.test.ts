import { describe, expect, it } from 'vitest';
import {
  applyReproduction,
  checkQuotes,
  currentFindings,
  findingsToVerify,
  reproRepairAllowed,
  verifierInput,
  type VerifierCheck,
} from '../src/index.ts';
import { makeFinding, makeRound } from './builders.ts';

const FILES: Record<string, string> = {
  'src/edge.ts':
    'export function edge() {\n    const stroke =   style.stroke;\n  return stroke;\n}\n',
};
const readFile = (path: string) => FILES[path] ?? null;
const check = (overrides: Partial<VerifierCheck> = {}): VerifierCheck => ({
  findingId: 'f1',
  verdict: 'confirmed',
  evidence: [{ file: 'src/edge.ts', line: 2, quote: 'const stroke = style.stroke;' }],
  ...overrides,
});

describe('verification', () => {
  it('the verifier never sees the proposed fix', () => {
    const finding = makeFinding({ suggestion: 'Use the profile timeout' });
    Object.assign(finding, { fix: 'heartbeatTimeout || profile.heartbeatTimeout' });
    const input = verifierInput(finding);
    expect(input).not.toHaveProperty('suggestion');
    expect(input).not.toHaveProperty('fix');
    expect(JSON.stringify(input)).not.toContain('profile');
    expect(input).toEqual({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      file: finding.file,
      line: finding.line,
      scenario: finding.scenario,
    });
  });

  it('only the current round is verified, and the newest round decides (P classify.test.ts:168, classify.test.ts:197)', () => {
    const old = makeRound({ findings: [makeFinding({ title: 'old' })] });
    const current = makeRound({ findings: [makeFinding({ title: 'new' })] });
    const failed = makeRound({ status: 'failed', findings: [makeFinding({ title: 'partial' })] });
    expect(findingsToVerify([old, current], current.id)).toEqual(current.findings);
    expect(findingsToVerify([old, current], 'missing')).toEqual([]);
    expect(currentFindings([old, current, failed])).toEqual(current.findings);
    expect(currentFindings([])).toEqual([]);
  });

  it('quotes must exist in the file; a missing quote or no evidence means Not proven (P review.test.ts:96)', () => {
    expect(checkQuotes(check(), readFile)).toEqual({
      verdict: 'confirmed',
      reason: { code: 'quotes_found', params: { findingId: 'f1', count: 1 } },
    });
    const invented = check({
      evidence: [{ file: 'src/edge.ts', line: 2, quote: 'const stroke = style.fill;' }],
    });
    expect(checkQuotes(invented, readFile)).toEqual({
      verdict: 'not_proven',
      reason: {
        code: 'quote_missing',
        params: { findingId: 'f1', file: 'src/edge.ts', quote: 'const stroke = style.fill;' },
      },
    });
    expect(checkQuotes(check({ evidence: [] }), readFile)).toEqual({
      verdict: 'not_proven',
      reason: { code: 'no_evidence', params: { findingId: 'f1' } },
    });
    // A Refuted verdict with a real quote stands, whatever the spacing.
    const refuted = check({
      verdict: 'refuted',
      evidence: [{ file: 'src/edge.ts', line: 2, quote: 'const stroke    = style.stroke;' }],
    });
    expect(checkQuotes(refuted, readFile).verdict).toBe('refuted');
  });

  it('the reproduction result beats the verdict: exit 0, 3 or other (P review.test.ts:111)', () => {
    const refutedByAgent = check({ verdict: 'refuted' });
    expect(applyReproduction(refutedByAgent, 0)).toEqual({
      verdict: 'confirmed',
      reason: {
        code: 'repro_reproduced',
        params: { findingId: 'f1', exitCode: 0, agentVerdict: 'refuted' },
      },
    });
    expect(applyReproduction(check(), 3).verdict).toBe('refuted');
    expect(applyReproduction(check(), 3).reason.code).toBe('repro_not_reproduced');
    expect(applyReproduction(check(), 1)).toEqual({
      verdict: 'not_proven',
      reason: {
        code: 'repro_broken',
        params: { findingId: 'f1', exitCode: 1, agentVerdict: 'confirmed' },
      },
    });
  });

  it('matches quotes regardless of whitespace, and a missing file fails', () => {
    const spaced = check({
      evidence: [
        { file: 'src/edge.ts', line: 2, quote: 'const stroke = style.stroke;\n return stroke;' },
      ],
    });
    expect(checkQuotes(spaced, readFile).verdict).toBe('confirmed');
    const missingFile = check({ evidence: [{ file: 'src/gone.ts', line: 1, quote: 'x' }] });
    expect(checkQuotes(missingFile, readFile).reason.code).toBe('quote_missing');
  });

  it('allows exactly one repair attempt for a broken reproduction', () => {
    expect(reproRepairAllowed(0)).toEqual({
      ok: true,
      reason: { code: 'repro_repair_allowed', params: { attempt: 1, max: 1 } },
    });
    expect(reproRepairAllowed(1)).toEqual({
      ok: false,
      reason: { code: 'repro_repairs_used', params: { used: 1, max: 1 } },
    });
  });
});
