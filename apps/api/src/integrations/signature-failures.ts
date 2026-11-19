// Webhook deliveries refused for a bad signature (S-20-T6). Kept in memory on purpose: an
// unauthenticated request never writes to the database. A restart starts the count again.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Enough for a day of a misconfigured secret; older entries drop first. */
const MAX_ENTRIES = 10_000;

export class SignatureFailures {
  readonly #times: number[] = [];

  record(at: Date = new Date()): void {
    this.#times.push(at.getTime());
    if (this.#times.length > MAX_ENTRIES) this.#times.shift();
  }

  /** How many failures since `since`, and when the newest one was (null when none since then). */
  since(since: Date): { count: number; last: Date | null } {
    const from = since.getTime();
    // Drop what no 24 h window can count again.
    const stale = Date.now() - DAY_MS;
    while (this.#times.length > 0 && this.#times[0]! < stale) this.#times.shift();
    const recent = this.#times.filter((t) => t >= from);
    const last = recent.at(-1);
    return { count: recent.length, last: last === undefined ? null : new Date(last) };
  }
}
