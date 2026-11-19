import { IntegrationNotConfiguredError } from '../errors.ts';
import {
  CLICKUP_NOT_CONFIGURED,
  type ClickUpGateway,
  type ClickUpSettings,
  type ClickUpTask,
  type ClickUpUser,
} from '../clickup/clickup-gateway.ts';

export type ClickUpCall =
  | { method: 'whoAmI' }
  | { method: 'getTask'; id: string }
  | { method: 'findTaskMentioningPr'; prUrl: string }
  | { method: 'createComment'; taskId: string; text: string; mentionUserId: string | null }
  | {
      method: 'createTask';
      listId: string;
      name: string;
      description: string;
      parentId: string | null;
    };

/**
 * An in-memory `ClickUpGateway` that records every call. Like the real one, a call without
 * settings fails with `clickup_not_configured`; `unconfigured: true` makes every call fail so.
 */
export class FakeClickUpGateway implements ClickUpGateway {
  readonly calls: ClickUpCall[] = [];
  readonly tasks = new Map<string, ClickUpTask>();
  readonly #unconfigured: boolean;
  readonly #failures = new Map<ClickUpCall['method'], Error[]>();
  #nextId = 1;

  constructor(options: { tasks?: ClickUpTask[]; unconfigured?: boolean } = {}) {
    for (const task of options.tasks ?? []) this.tasks.set(task.id, task);
    this.#unconfigured = options.unconfigured ?? false;
  }

  /** The next call of `method` rejects with `error` (after the settings check). */
  failNext(method: ClickUpCall['method'], error: Error): this {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), error]);
    return this;
  }

  callsOf<M extends ClickUpCall['method']>(method: M): Extract<ClickUpCall, { method: M }>[] {
    return this.calls.filter(
      (call): call is Extract<ClickUpCall, { method: M }> => call.method === method,
    );
  }

  /** `CLICKUP_API_KEY` when built `unconfigured`. */
  get missingEnv(): readonly string[] {
    return this.#unconfigured ? ['CLICKUP_API_KEY'] : [];
  }

  async whoAmI(): Promise<ClickUpUser> {
    if (this.#unconfigured) {
      throw new IntegrationNotConfiguredError(CLICKUP_NOT_CONFIGURED, ['CLICKUP_API_KEY']);
    }
    this.calls.push({ method: 'whoAmI' });
    this.#fail('whoAmI');
    return { id: '1', username: 'pr-review-agent' };
  }

  async getTask(settings: ClickUpSettings | null, id: string): Promise<ClickUpTask | null> {
    this.#check(settings);
    this.calls.push({ method: 'getTask', id });
    this.#fail('getTask');
    return this.#find(id);
  }

  async findTaskMentioningPr(
    settings: ClickUpSettings | null,
    prUrl: string,
  ): Promise<ClickUpTask | null> {
    this.#check(settings);
    this.calls.push({ method: 'findTaskMentioningPr', prUrl });
    this.#fail('findTaskMentioningPr');
    const mentions = new RegExp(`${prUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);
    return [...this.tasks.values()].find((task) => mentions.test(task.description)) ?? null;
  }

  async createComment(
    settings: ClickUpSettings | null,
    taskId: string,
    comment: { text: string; mentionUserId?: string | null },
  ): Promise<{ id: string }> {
    this.#check(settings);
    this.calls.push({
      method: 'createComment',
      taskId,
      text: comment.text,
      mentionUserId: comment.mentionUserId ?? null,
    });
    this.#fail('createComment');
    return { id: `comment-${this.#nextId++}` };
  }

  async createTask(
    settings: ClickUpSettings | null,
    listId: string,
    task: { name: string; description: string; parentId?: string | null },
  ): Promise<{ id: string; url: string }> {
    this.#check(settings);
    const parentId = task.parentId ?? null;
    this.calls.push({ method: 'createTask', listId, ...task, parentId });
    this.#fail('createTask');
    const id = `task-${this.#nextId++}`;
    const url = `https://app.clickup.com/t/${id}`;
    this.tasks.set(id, {
      id,
      customId: null,
      name: task.name,
      description: task.description,
      url,
      status: 'to do',
      listId,
    });
    return { id, url };
  }

  #fail(method: ClickUpCall['method']): void {
    const failure = this.#failures.get(method)?.shift();
    if (failure) throw failure;
  }

  #find(id: string): ClickUpTask | null {
    return (
      this.tasks.get(id) ??
      [...this.tasks.values()].find((task) => task.customId?.toLowerCase() === id.toLowerCase()) ??
      null
    );
  }

  #check(settings: ClickUpSettings | null): void {
    if (this.#unconfigured) {
      throw new IntegrationNotConfiguredError(CLICKUP_NOT_CONFIGURED, ['CLICKUP_API_KEY']);
    }
    if (!settings) {
      throw new IntegrationNotConfiguredError(CLICKUP_NOT_CONFIGURED, ['RepositoryConfig.clickup']);
    }
  }
}
