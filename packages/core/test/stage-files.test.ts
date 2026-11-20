import { describe, expect, it } from 'vitest';
import {
  ALL_MARKDOWN_DOCUMENTS,
  BUILT_IN_FILE,
  defaultKindOf,
  instructionFileKeyProblem,
  isEmptyStageFileChoice,
  missingInstructions,
  resolveStageFiles,
  resolveStageSlots,
  stageFileReaders,
  type StageSlotDecl,
} from '../src/index.ts';

const VERIFY: StageSlotDecl[] = [
  { name: 'prompt', kind: 'instruction', default: 'prompt-verifier.md', required: true },
  { name: 'rules', kind: 'instruction', default: 'verify-rules.md', required: true },
];
const REVIEW: StageSlotDecl[] = [
  { name: 'prompt', kind: 'instruction', default: 'prompt-reviewer.md', builtIn: true },
  { name: 'rules', kind: 'instruction', default: 'review-rules.md' },
  { name: 'documents', kind: 'document', default: ALL_MARKDOWN_DOCUMENTS },
];
const DOCUMENTS = ['lessons.md', 'feature-map/sdk.md', 'review-levels.json'];

describe('instruction kinds', () => {
  it.each([
    ['prompt-reviewer.md', 'instruction'],
    ['feature-map/prompt-x.md', 'instruction'],
    ['verify-rules.md', 'instruction'],
    ['team/review-rules.md', 'instruction'],
    ['lessons.md', 'document'],
    ['feature-map/sdk.md', 'document'],
    ['review-levels.json', 'document'],
    ['prompt-notes.txt', 'document'],
    ['rules.md', 'document'],
  ])('%s is an %s', (key, kind) => {
    expect(defaultKindOf(key)).toBe(kind);
  });

  it.each([
    ['verify-rules-strict.md', null],
    ['feature-map/new.md', null],
    ['', 'key_empty'],
    ['a'.repeat(201), 'key_too_long'],
    ['@built-in', 'key_path'],
    ['/abs.md', 'key_path'],
    ['../up.md', 'key_path'],
    ['a//b.md', 'key_path'],
    [' padded.md', 'key_path'],
    ['win\\path.md', 'key_path'],
  ])('key %j → %s', (key, problem) => {
    expect(instructionFileKeyProblem(key)).toBe(problem);
  });
});

describe('resolveStageFiles', () => {
  const none = { global: {}, repository: {} };

  it('reads the declared defaults when nobody chose', () => {
    expect(resolveStageFiles({ verify: VERIFY, review: REVIEW }, none, DOCUMENTS)).toEqual({
      verify: { prompt: 'prompt-verifier.md', rules: 'verify-rules.md', documents: [] },
      review: {
        prompt: 'prompt-reviewer.md',
        rules: 'review-rules.md',
        // Every Markdown document; the JSON file is not read.
        documents: ['feature-map/sdk.md', 'lessons.md'],
      },
    });
  });

  it('a global choice beats the default, a repository override beats the global choice', () => {
    const global = { verify: { rules: 'verify-rules-global.md' } };
    expect(resolveStageFiles({ verify: VERIFY }, { global, repository: {} }, []).verify).toEqual({
      prompt: 'prompt-verifier.md',
      rules: 'verify-rules-global.md',
      documents: [],
    });
    const repository = { verify: { rules: 'verify-rules-strict.md' } };
    expect(resolveStageFiles({ verify: VERIFY }, { global, repository }, []).verify?.rules).toBe(
      'verify-rules-strict.md',
    );
  });

  it('a reset slot (null or missing) inherits again', () => {
    const global = { verify: { rules: 'verify-rules-global.md' } };
    const repository = { verify: { rules: null, prompt: undefined } };
    const slots = resolveStageSlots(VERIFY, global.verify, repository.verify, []);
    expect(slots).toEqual([
      { name: 'prompt', source: 'default', value: ['prompt-verifier.md'] },
      { name: 'rules', source: 'global', value: ['verify-rules-global.md'] },
    ]);
    expect(isEmptyStageFileChoice(repository.verify)).toBe(true);
    expect(isEmptyStageFileChoice({ documents: [] })).toBe(false);
  });

  it('the built-in prompt resolves to null; an explicit document list replaces "all"', () => {
    const files = resolveStageFiles(
      { review: REVIEW },
      {
        global: { review: { prompt: BUILT_IN_FILE, documents: ['lessons.md', 'lessons.md'] } },
        repository: {},
      },
      DOCUMENTS,
    );
    expect(files.review).toEqual({
      prompt: null,
      rules: 'review-rules.md',
      documents: ['lessons.md'],
    });
  });

  it('names the stages that read a file', () => {
    const files = resolveStageFiles({ verify: VERIFY, review: REVIEW }, none, DOCUMENTS);
    expect(stageFileReaders('lessons.md', files)).toEqual(['review']);
    expect(stageFileReaders('verify-rules.md', files)).toEqual(['verify']);
    expect(stageFileReaders('review-levels.json', files)).toEqual([]);
  });
});

describe('missingInstructions with assigned files', () => {
  const files = new Map([
    ['prompt-verifier.md', 'p'],
    ['verify-rules.md', 'r'],
    ['verify-rules-b.md', ' '],
  ]);

  it('checks the defaults when the stage has no assignment', () => {
    expect(missingInstructions(files, ['verify', 'analyse'], {})).toEqual([
      { stage: 'analyse', missing: ['prompt-analyst.md', 'analyst-rules.md'] },
    ]);
  });

  it('names the assigned key that is missing or empty', () => {
    const stageFiles = {
      verify: { prompt: 'prompt-verifier.md', rules: 'verify-rules-b.md', documents: [] },
      analyst: { prompt: 'prompt-a2.md', rules: 'analyst-rules.md', documents: [] },
    };
    expect(missingInstructions(files, ['verify', 'analyse'], stageFiles)).toEqual([
      { stage: 'verify', missing: ['verify-rules-b.md'] },
      { stage: 'analyse', missing: ['prompt-a2.md', 'analyst-rules.md'] },
    ]);
  });
});
