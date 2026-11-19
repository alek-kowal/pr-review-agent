import { describe, expect, it } from 'vitest';
import {
  findTaskId,
  isValidTaskIdPattern,
  RepositoryConfigSchema,
  taskIdFromRef,
} from '../src/index.ts';

const WB = 'WB-\\d+';
const CU = 'CU-[a-z0-9]+';

describe('findTaskId', () => {
  it('finds the id in the branch', () => {
    expect(findTaskId('feature/WB-123-fix-save', 'Fix save', WB)).toBe('WB-123');
    expect(findTaskId('CU-86c0abc_save', 'Fix save', CU)).toBe('CU-86c0abc');
  });

  it('falls back to the title', () => {
    expect(findTaskId('fix-save', '[WB-77] Fix save', WB)).toBe('WB-77');
    expect(findTaskId('fix-save', 'Fix save (WB-77)', WB)).toBe('WB-77');
  });

  it('the branch wins over the title', () => {
    expect(findTaskId('wb-1-save', 'WB-2: Fix save', WB)).toBe('wb-1');
  });

  it('ignores case and returns the id as written', () => {
    expect(findTaskId('feature/wb-9', '', WB)).toBe('wb-9');
    expect(findTaskId('main', 'cu-AB12 fix', CU)).toBe('cu-AB12');
  });

  it('takes the whole number', () => {
    expect(findTaskId('WB-1234', '', WB)).toBe('WB-1234');
  });

  it('never matches inside another word or number', () => {
    expect(findTaskId('feature/AWB-12', 'NEWB-3 and WB-12x', WB)).toBeNull();
    expect(findTaskId('swb-12', 'xcu-ab1', CU)).toBeNull();
    expect(findTaskId('feature/zażółćWB-5', '', WB)).toBeNull();
  });

  it('returns null without an id', () => {
    expect(findTaskId('main', 'Bump deps', WB)).toBeNull();
    expect(findTaskId('', '', WB)).toBeNull();
  });
});

describe('ClickUp settings in RepositoryConfig', () => {
  const base = { slug: 'wb', githubFullName: 'synergycodes/workflowbuilder' };

  it('is off by default', () => {
    expect(RepositoryConfigSchema.parse(base).clickup).toBeNull();
  });

  it('takes the workspace, the follow-up list and the task id pattern', () => {
    const config = RepositoryConfigSchema.parse({
      ...base,
      clickup: { workspaceId: '9012', followUpListId: '901', taskIdPattern: WB },
    });
    expect(config.clickup).toEqual({
      workspaceId: '9012',
      spaceId: null,
      followUpListId: '901',
      taskIdPattern: WB,
    });
  });

  it('rejects a pattern that does not compile or matches nothing at all', () => {
    expect(isValidTaskIdPattern(WB)).toBe(true);
    expect(isValidTaskIdPattern('WB-(')).toBe(false);
    expect(isValidTaskIdPattern('\\d*')).toBe(false);
    const parsed = RepositoryConfigSchema.safeParse({
      ...base,
      clickup: { workspaceId: '9012', taskIdPattern: 'WB-(' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('taskIdFromRef', () => {
  it('reads an id as typed', () => {
    expect(taskIdFromRef(' WB-123 ')).toBe('WB-123');
    expect(taskIdFromRef('#86c1abc')).toBe('86c1abc');
  });

  it('reads the id from a task link', () => {
    expect(taskIdFromRef('https://app.clickup.com/t/86c1abc')).toBe('86c1abc');
    expect(taskIdFromRef('https://app.clickup.com/t/9012/WB-123?comment=5')).toBe('WB-123');
    expect(taskIdFromRef('app.clickup.com/t/86c1abc/')).toBe('86c1abc');
  });

  it('rejects anything else', () => {
    expect(taskIdFromRef('')).toBeNull();
    expect(taskIdFromRef('fix the edge labels')).toBeNull();
    expect(taskIdFromRef('https://example.com/t/86c1abc')).toBeNull();
  });
});
