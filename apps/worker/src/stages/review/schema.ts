// The reviewer's answer, ported from P's `reviewSchema` (src/review.ts). The findings array is
// not capped here: core `enforce` cuts it to the level's limit, so an answer with 9 findings
// still parses.
import type { Severity } from '@pra/core';
import { z } from 'zod';

export const REVIEWER_SEVERITIES = ['blocker', 'should', 'nit'] as const;
export type ReviewerSeverity = (typeof REVIEWER_SEVERITIES)[number];

/** P's severities to core `Severity`. */
export const SEVERITY_MAP: Readonly<Record<ReviewerSeverity, Severity>> = {
  blocker: 'blocking',
  should: 'worth_fixing',
  nit: 'nit',
};

const text = z.string();

export const reviewOutputSchema = z.object({
  summary: text.describe(
    'At most two short sentences: what the PR does and what is wrong with it. No paths to decisions.',
  ),
  risk: z.enum(['low', 'medium', 'high']),
  findings: z.array(
    z.object({
      title: text,
      severity: z.enum(REVIEWER_SEVERITIES),
      file: text,
      line: z.number().int(),
      scenario: text.describe('At most two sentences: with what input or state what goes wrong.'),
      suggestion: text.describe('One sentence: what to change.'),
      fix: z
        .object({
          before: text.describe('The current code, verbatim from the file, at most 10 lines.'),
          after: text.describe('The same code after the fix.'),
        })
        .optional()
        .describe('Optional, when the fix is a few lines in one place of `file`.'),
    }),
  ),
  gatedNotes: z
    .array(
      z.object({
        path: text,
        note: text.describe('One sentence: what changes there and whether it is safe.'),
      }),
    )
    .optional()
    .describe('One entry per sensitive path listed in the brief.'),
  questions: z.array(
    z.object({
      question: text,
      options: z.array(text).min(2).max(3),
      recommended: z.number().int().min(0).describe('Index of the recommended option, from 0.'),
      why: text,
    }),
  ),
  notChecked: z.array(text).max(5),
});

export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
