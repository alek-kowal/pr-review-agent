// S-22-T9: the pipeline descriptor (`@pra/agents`) says what the worker's stages really read and
// write, so Settings → Pipeline never drifts from the code.
import { PIPELINE_STAGES } from '@pra/agents';
import { STAGE_KEYS } from '@pra/core';
import { expect, test } from 'vitest';
import type { ChecksOutput } from '../src/stages/checks.ts';
import { JUDGE_PROMPT_FILE, JUDGE_RULES_FILE } from '../src/stages/change-type.ts';
import { REVIEWER_PROMPT_FILE } from '../src/stages/review/prompt.ts';
import { reviewOutputSchema } from '../src/stages/review/schema.ts';
import { VERIFIER_PROMPT_FILE, VERIFIER_RULES_FILE } from '../src/stages/verify.ts';

const stage = (key: string) => PIPELINE_STAGES.find((s) => s.key === key)!;

test('the round stages come first, in run order', () => {
  expect(PIPELINE_STAGES.slice(0, STAGE_KEYS.length).map((s) => s.key)).toEqual([...STAGE_KEYS]);
});

test('each stage lists the instruction files its executor reads', () => {
  expect(stage('review').instructionFiles[0]).toBe(REVIEWER_PROMPT_FILE);
  expect(stage('change_type').instructionFiles).toEqual([JUDGE_PROMPT_FILE, JUDGE_RULES_FILE]);
  expect(stage('verify').instructionFiles).toEqual([VERIFIER_PROMPT_FILE, VERIFIER_RULES_FILE]);
});

test('the output fields match the stage output', () => {
  expect(stage('review').output.fields).toEqual(Object.keys(reviewOutputSchema.shape));
  const checks: readonly (keyof ChecksOutput)[] = ['ci', 'install'];
  expect(stage('checks').output.fields).toEqual(checks);
});
