// Every signed settings write goes through `applySignedSettingsChange`: it checks the signature and
// that the client's `before` is still current, applies the change and writes one `settings_changes`
// row, all in one transaction (Accountability and Concurrent edits NFRs).
import {
  countActiveTeamMembers,
  getActiveTeamMember,
  insertSettingsChange,
  type Db,
  type Executor,
  type SettingsChange,
} from '@pra/db';

/** One Settings area: how to read (and lock) an entity's current value and how to write it. */
export type SettingsStore<T> = {
  /** The area name in the log, for example `team`. */
  area: string;
  /** The entity's current value, locked until the transaction ends; null when it does not exist. */
  read(tx: Executor, entity: string): Promise<T | null>;
  /**
   * Writes `after` (null removes the entity). Returns the entity's key, which a create learns
   * here, and the value as stored. A thrown error rolls the whole change back.
   */
  write(
    tx: Executor,
    entity: string,
    after: T | null,
  ): Promise<{ entity: string; value: T | null }>;
};

/** The entity key a create passes before the store gives it its real key. */
export const NEW_ENTITY = 'new';

export type SignedSettingsChangeInput<T> = {
  store: SettingsStore<T>;
  entity: string;
  /** The value the signer saw; null for a create. */
  before: T | null;
  /** The value to save; null to remove. */
  after: T | null;
  /** The signing Team member's id. */
  signer: string | null | undefined;
  /**
   * Sign as the member this change creates. Allowed only while Team has no active member, since
   * then nobody could sign: the first member signs as themselves.
   */
  signAsCreated?: boolean;
  note?: string | null;
};

export type SignedSettingsChangeError =
  | { status: 400; code: 'signature_required'; params: Record<string, never> }
  | { status: 400; code: 'signer_unknown'; params: { signer: string } }
  /** Someone saved in between; `current` is what is stored now. */
  | { status: 409; code: 'settings_stale'; params: { current: unknown } };

export type SignedSettingsChangeResult<T> =
  | {
      ok: true;
      entity: string;
      value: T | null;
      /** Null when `after` equals what is stored, so nothing was written. */
      change: SettingsChange | null;
    }
  | ({ ok: false } & SignedSettingsChangeError);

export async function applySignedSettingsChange<T>(
  db: Pick<Db, 'transaction'>,
  input: SignedSettingsChangeInput<T>,
): Promise<SignedSettingsChangeResult<T>> {
  const { store } = input;
  return db.transaction(async (tx) => {
    if (input.signAsCreated) {
      if ((await countActiveTeamMembers(tx)) > 0) return refuse('signature_required');
    } else {
      if (!input.signer) return refuse('signature_required');
      if (!(await getActiveTeamMember(tx, input.signer))) {
        return { ok: false, status: 400, code: 'signer_unknown', params: { signer: input.signer } };
      }
    }

    const current = await store.read(tx, input.entity);
    if (!sameJson(current, input.before)) {
      return { ok: false, status: 409, code: 'settings_stale', params: { current } };
    }
    if (sameJson(current, input.after)) {
      return { ok: true, entity: input.entity, value: current, change: null };
    }

    const written = await store.write(tx, input.entity, input.after);
    const signerId = input.signAsCreated ? written.entity : input.signer!;
    const change = await insertSettingsChange(tx, {
      area: store.area,
      entity: written.entity,
      actor: 'member',
      signerId,
      before: current,
      after: written.value,
      note: input.note ?? null,
    });
    return { ok: true, entity: written.entity, value: written.value, change };
  });
}

const refuse = (code: 'signature_required') =>
  ({ ok: false, status: 400, code, params: {} }) as const;

/**
 * Whether two JSON values are the same, ignoring key order. A null or missing field counts as
 * the same, so a client may leave out an empty optional field.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, field]) => field !== null && field !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
    );
  });
}
