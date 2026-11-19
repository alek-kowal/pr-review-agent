// Number and time formats shared by copy files.

const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

/** Dollars with cents: `$1.84`. */
export const money = (usd: unknown): string => `$${n(usd).toFixed(2)}`;

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

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
