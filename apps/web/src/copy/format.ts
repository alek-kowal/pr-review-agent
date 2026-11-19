// Number and time formats shared by copy files.

const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

/**
 * What a dollar amount means (P-25): real spend on an API key; on a Claude subscription the SDK's
 * price of the same usage at API rates, which nobody is billed. Set from `GET /api/status`
 * (`modelAuth`) before any page renders (`RootLayout`).
 */
export type CostBasis = 'spend' | 'api_equivalent';
let costBasis: CostBasis = 'spend';

export const costBasisOf = (modelAuth: string | undefined): CostBasis =>
  modelAuth === 'subscription' ? 'api_equivalent' : 'spend';
export const setCostBasis = (basis: CostBasis): void => {
  costBasis = basis;
};
export const isApiEquivalent = (): boolean => costBasis === 'api_equivalent';

/** The one wording every amount carries on a subscription. */
export const API_EQUIVALENT = 'API-equivalent';
const basisSuffix = (): string => (isApiEquivalent() ? ` ${API_EQUIVALENT}` : '');

/** Dollars with cents, never labelled: chart ticks and amounts a label already covers. */
export const amount = (usd: unknown): string => `$${n(usd).toFixed(2)}`;

/** Dollars with cents: `$1.84`; on a subscription `$1.84 API-equivalent`. */
export const money = (usd: unknown): string => `${amount(usd)}${basisSuffix()}`;

/** Two amounts labelled once: `$1.20 of $10.00` (`… API-equivalent` on a subscription). */
export const moneyOf = (part: unknown, whole: unknown): string =>
  `${amount(part)} of ${amount(whole)}${basisSuffix()}`;

/** A spend hint: real spend on an API key, the API-equivalent explanation on a subscription. */
export const spendHint = (real: string): string =>
  isApiEquivalent()
    ? `${API_EQUIVALENT}: the API price of this usage. A Claude subscription is not billed per token.`
    : real;

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** A review's counts: "2 worth implementing, 1 not worth it" (either part left out at 0). */
export const reviewCounts = (worth: number, notWorth: number): string =>
  [worth > 0 && `${worth} worth implementing`, notWorth > 0 && `${notWorth} not worth it`]
    .filter(Boolean)
    .join(', ');

/** A duration as `45 s`, `12 min`, `3 h 5 min` or `2 d 4 h`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d} d` : `${d} d ${h % 24} h`;
}

/** A clock time in the viewer's time zone: `14:02`. */
export const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** A date and time: `19 Nov, 14:02`. */
export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
