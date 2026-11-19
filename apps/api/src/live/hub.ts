// S-03-T2: fans one change subscription out to every connected SSE client.
export const HEARTBEAT_MS = 15_000;

/** What the hub writes to: an SSE response stream. */
export type LiveClient = { write(chunk: string): unknown; end?(): unknown };

/** One SSE message: `event: <name>` and one JSON data line. */
export function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_HEARTBEAT = ': heartbeat\n\n';

/**
 * Connected clients and one heartbeat timer, running only while a client is connected. The
 * subscription is started by the first client (`onFirstClient`), once.
 */
export class LiveHub {
  readonly #clients = new Set<LiveClient>();
  readonly #heartbeatMs: number;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: { heartbeatMs?: number } = {}) {
    this.#heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  }

  get size(): number {
    return this.#clients.size;
  }

  /** Adds a client; the returned function removes it. */
  add(client: LiveClient): () => void {
    this.#clients.add(client);
    this.#timer ??= setInterval(() => this.#send(SSE_HEARTBEAT), this.#heartbeatMs);
    return () => this.remove(client);
  }

  remove(client: LiveClient): void {
    this.#clients.delete(client);
    if (this.#clients.size === 0) this.#stopTimer();
  }

  broadcast(event: string, data: unknown): void {
    this.#send(sseMessage(event, data));
  }

  /** Ends every client's stream (the server cannot close while one is open). */
  close(): void {
    for (const client of this.#clients) {
      try {
        client.end?.();
      } catch {
        // Already closed.
      }
    }
    this.#clients.clear();
    this.#stopTimer();
  }

  #send(chunk: string): void {
    for (const client of this.#clients) {
      try {
        client.write(chunk);
      } catch {
        this.remove(client);
      }
    }
  }

  #stopTimer(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
