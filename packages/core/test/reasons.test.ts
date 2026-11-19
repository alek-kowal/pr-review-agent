import { describe, expect, expectTypeOf, it } from 'vitest';
import { reason, type NoParams, type Reason, type ReasonCode } from '../src/index.ts';

// Test-only codes, declared the same way a family declares its own.
declare module '../src/reason.ts' {
  interface ReasonParams {
    test_plain: NoParams;
    test_with_path: { path: string };
  }
}

describe('reason codes', () => {
  it('builds { code, params } with empty params for a plain code', () => {
    expect(reason('test_plain')).toEqual({ code: 'test_plain', params: {} });
  });

  it('types the params of each code', () => {
    const r = reason('test_with_path', { path: 'src/a.ts' });
    expect(r).toEqual({ code: 'test_with_path', params: { path: 'src/a.ts' } });
    expectTypeOf(r).toEqualTypeOf<{ code: 'test_with_path'; params: { path: string } }>();
    expectTypeOf<Reason<'test_with_path'>['params']>().toEqualTypeOf<{ path: string }>();

    // @ts-expect-error params are required when the code declares some
    reason('test_with_path');
    // @ts-expect-error params must have the declared shape
    reason('test_with_path', { file: 'src/a.ts' });
  });

  it('rejects an unknown code at compile time', () => {
    expectTypeOf<'no_such_code'>().not.toExtend<ReasonCode>();
    // @ts-expect-error unknown code
    expect(reason('no_such_code')).toEqual({ code: 'no_such_code', params: {} });
  });

  it('narrows a Reason union by its code', () => {
    const r = reason('test_with_path', { path: 'x' }) as Reason<'test_plain' | 'test_with_path'>;
    if (r.code === 'test_with_path') expectTypeOf(r.params).toEqualTypeOf<{ path: string }>();
  });
});
