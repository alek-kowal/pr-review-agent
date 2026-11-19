import { describe, expect, it } from 'vitest';
import { decisionLabelNames, usuallyDecidedBy } from '../src/index.ts';

const kasia = { id: 'm-kasia', name: 'Kasia', githubLogin: 'kasia-dev' };
const tomek = { id: 'm-tomek', name: 'Tomek', githubLogin: 'tomek' };

describe('usuallyDecidedBy', () => {
  it("names the author's Team member by GitHub login, ignoring case", () => {
    expect(usuallyDecidedBy({ authorLogin: 'Kasia-Dev' }, [tomek, kasia])).toEqual({
      login: 'Kasia-Dev',
      memberId: 'm-kasia',
      name: 'Kasia',
    });
  });

  it("falls back to the author's login when no member has it", () => {
    expect(usuallyDecidedBy({ authorLogin: 'outsider' }, [tomek, kasia])).toEqual({
      login: 'outsider',
      memberId: null,
      name: null,
    });
  });

  it('skips a removed member with the login', () => {
    const removed = { ...kasia, removedAt: new Date('2026-01-01') };
    expect(usuallyDecidedBy({ authorLogin: 'kasia-dev' }, [removed]).memberId).toBeNull();
  });
});

describe('decisionLabelNames', () => {
  const author = usuallyDecidedBy({ authorLogin: 'kasia-dev' }, [tomek, kasia]);

  it('names both when someone else signed', () => {
    expect(decisionLabelNames({ id: tomek.id, name: tomek.name }, author)).toEqual({
      signer: 'Tomek',
      author: 'Kasia',
    });
  });

  it('names one when the author signed', () => {
    expect(decisionLabelNames({ id: kasia.id, name: kasia.name }, author)).toEqual({
      signer: 'Kasia',
      author: null,
    });
  });

  it('names the author by login when they are not on the Team', () => {
    const outsider = usuallyDecidedBy({ authorLogin: 'outsider' }, [tomek]);
    expect(decisionLabelNames({ id: tomek.id, name: tomek.name }, outsider).author).toBe(
      'outsider',
    );
  });
});
