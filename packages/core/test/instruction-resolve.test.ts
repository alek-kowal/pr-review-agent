import { describe, expect, it } from 'vitest';
import { diffSummary, lineDiff, resolveInstructions, type InstructionLayer } from '../src/index.ts';

let nextId = 1;
const layer = (
  fileKey: string,
  content: string,
  where: Partial<Pick<InstructionLayer, 'scope' | 'repositoryId' | 'level' | 'version'>> = {},
): InstructionLayer => ({
  versionId: nextId++,
  fileKey,
  scope: where.scope ?? 'global',
  repositoryId: where.repositoryId ?? null,
  level: where.level ?? null,
  version: where.version ?? 1,
  content,
});

const WB = 1;
const OTHER = 2;
const contentOf = (result: ReturnType<typeof resolveInstructions>, key: string) =>
  result.files.find((f) => f.fileKey === key)?.content;

describe('resolveInstructions', () => {
  const global = layer('review-rules.md', 'global rules');
  const wbCopy = layer('review-rules.md', 'WB rules', { scope: 'repository', repositoryId: WB });
  const level3 = layer('review-rules.md', 'level 3 rules', { scope: 'level', level: 3 });
  const lessons = layer('lessons.md', 'WB lessons', { scope: 'repository', repositoryId: WB });

  it('takes a repository copy over the global file', () => {
    const result = resolveInstructions([global, wbCopy], { repositoryId: WB, level: 1 });
    expect(contentOf(result, 'review-rules.md')).toBe('WB rules');
    expect(result.files[0]!.layers.map((l) => l.versionId)).toEqual([wbCopy.versionId]);
  });

  it('takes a level copy over both', () => {
    const all = [level3, global, wbCopy];
    expect(
      contentOf(resolveInstructions(all, { repositoryId: WB, level: 3 }), 'review-rules.md'),
    ).toBe('level 3 rules');
    // At another level the copy does not apply.
    expect(
      contentOf(resolveInstructions(all, { repositoryId: WB, level: 2 }), 'review-rules.md'),
    ).toBe('WB rules');
  });

  it("never applies one repository's copy to another repository", () => {
    const result = resolveInstructions([global, wbCopy, lessons], {
      repositoryId: OTHER,
      level: 1,
    });
    expect(contentOf(result, 'review-rules.md')).toBe('global rules');
    expect(contentOf(result, 'lessons.md')).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('lists files by key', () => {
    const result = resolveInstructions([global, lessons], { repositoryId: WB, level: 1 });
    expect(result.files.map((f) => f.fileKey)).toEqual(['lessons.md', 'review-rules.md']);
  });

  describe('a JSON file', () => {
    const levelsGlobal = layer(
      'review-levels.json',
      JSON.stringify({ default: 1, levels: { '1': { maxFindings: 10, brief: 'short' } } }),
    );

    it('falls back field by field with a warning when a field is broken', () => {
      const broken = layer(
        'review-levels.json',
        JSON.stringify({ default: 'two', levels: { '1': { maxFindings: 'many', brief: 'WB' } } }),
        { scope: 'repository', repositoryId: WB, version: 2 },
      );
      const result = resolveInstructions([levelsGlobal, broken], { repositoryId: WB, level: 1 });
      expect(JSON.parse(contentOf(result, 'review-levels.json')!)).toEqual({
        default: 1,
        levels: { '1': { maxFindings: 10, brief: 'WB' } },
      });
      expect(result.warnings).toEqual([
        {
          code: 'instruction_field_invalid',
          params: {
            fileKey: 'review-levels.json',
            scope: 'repository',
            version: 2,
            field: 'default',
          },
        },
        {
          code: 'instruction_field_invalid',
          params: {
            fileKey: 'review-levels.json',
            scope: 'repository',
            version: 2,
            field: 'levels.1.maxFindings',
          },
        },
      ]);
      expect(result.files[0]!.layers).toHaveLength(2);
    });

    it('skips a layer that does not parse, with a warning', () => {
      const unparsable = layer('review-levels.json', '{ "default": ', {
        scope: 'level',
        level: 2,
      });
      const result = resolveInstructions([levelsGlobal, unparsable], {
        repositoryId: WB,
        level: 2,
      });
      expect(contentOf(result, 'review-levels.json')).toBe(levelsGlobal.content);
      expect(result.warnings.map((w) => w.code)).toEqual(['instruction_json_invalid']);
    });
  });
});

describe('lineDiff', () => {
  it('marks added and removed lines', () => {
    const diff = lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(diff).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'B' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
    expect(diffSummary(diff)).toEqual({ added: 2, removed: 1 });
  });

  it('is empty for two empty texts and all same for equal texts', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(diffSummary(lineDiff('x\ny', 'x\ny'))).toEqual({ added: 0, removed: 0 });
  });
});
