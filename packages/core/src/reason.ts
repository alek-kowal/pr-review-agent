/**
 * Core never returns prose. It returns a reason code with typed params; the web maps codes to copy.
 *
 * Each family declares its codes in its own `src/reasons/<family>.ts` by declaration merging:
 *
 *     declare module '../reason.ts' {
 *       interface ReasonParams {
 *         nit_optional: NoParams;
 *         path_one_way: { path: string };
 *       }
 *     }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface ReasonParams {}

export type ReasonCode = keyof ReasonParams;

/** Params of a code that carries none. */
export type NoParams = Record<string, never>;

/** `{ code, params }`, a discriminated union over every known code. */
export type Reason<C extends ReasonCode = ReasonCode> = C extends ReasonCode
  ? { code: C; params: ReasonParams[C] }
  : never;

type ParamsArg<C extends ReasonCode> = ReasonParams[C] extends NoParams
  ? [params?: NoParams]
  : [params: ReasonParams[C]];

/** Builds a reason. Params are required exactly when the code declares some. */
export function reason<C extends ReasonCode>(code: C, ...args: ParamsArg<C>): Reason<C> {
  return { code, params: args[0] ?? {} } as Reason<C>;
}

/** The result of a rule that allows or refuses something. */
export type Check = { ok: true; reason: Reason } | { ok: false; reason: Reason };
