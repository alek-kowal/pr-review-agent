import { IntegrationError, IntegrationNotConfiguredError } from '../errors.ts';
import {
  CLICKUP_AUTH_FAILED,
  CLICKUP_ENV,
  CLICKUP_ERROR,
  CLICKUP_NOT_CONFIGURED,
  isCustomTaskId,
  type ClickUpGateway,
  type ClickUpSettings,
  type ClickUpTask,
} from './clickup-gateway.ts';

export const CLICKUP_API = 'https://api.clickup.com/api/v2';
/** How far back and how deep the PR search looks (as in v1). */
const SEARCH_DAYS = 90;
const SEARCH_PAGES = 10;

export type HttpClickUpGatewayOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

type RawTask = {
  id: string;
  custom_id?: string | null;
  name: string;
  markdown_description?: string | null;
  description?: string | null;
  url: string;
  status?: { status?: string } | null;
  list?: { id?: string } | null;
};

/** `ClickUpGateway` on the ClickUp REST API v2 with a personal or app token. */
export class HttpClickUpGateway implements ClickUpGateway {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(options: HttpClickUpGatewayOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl ?? CLICKUP_API;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async getTask(settings: ClickUpSettings | null, id: string): Promise<ClickUpTask | null> {
    const s = required(settings);
    const query = taskIdQuery(s, id);
    query.set('include_markdown_description', 'true');
    const raw = await this.#request<RawTask>('GET', `/task/${encodeURIComponent(id)}`, query, {
      notFound: true,
    });
    return raw ? toTask(raw) : null;
  }

  async findTaskMentioningPr(
    settings: ClickUpSettings | null,
    prUrl: string,
  ): Promise<ClickUpTask | null> {
    const s = required(settings);
    // The PR link, not a longer number that starts the same (`/pull/12` must not match `/pull/123`).
    const mentionsPr = new RegExp(`${escapeRegExp(prUrl)}(?![\\d])`);
    const since = this.#now() - SEARCH_DAYS * 24 * 3600 * 1000;
    for (let page = 0; page < SEARCH_PAGES; page++) {
      const query = new URLSearchParams({
        page: String(page),
        include_closed: 'true',
        subtasks: 'true',
        include_markdown_description: 'true',
        date_updated_gt: String(since),
      });
      if (s.spaceId) query.append('space_ids[]', s.spaceId);
      const body = await this.#request<{ tasks?: RawTask[]; last_page?: boolean }>(
        'GET',
        `/team/${encodeURIComponent(s.workspaceId)}/task`,
        query,
      );
      const tasks = body?.tasks ?? [];
      const found = tasks.find((task) => mentionsPr.test(descriptionOf(task)));
      if (found) return toTask(found);
      if (body?.last_page || tasks.length === 0) return null;
    }
    return null;
  }

  async createComment(
    settings: ClickUpSettings | null,
    taskId: string,
    comment: { text: string; mentionUserId?: string | null },
  ): Promise<{ id: string }> {
    const s = required(settings);
    const body = comment.mentionUserId
      ? {
          comment: [
            { type: 'tag', user: { id: Number(comment.mentionUserId) } },
            { text: ` ${comment.text}` },
          ],
          notify_all: false,
        }
      : { comment_text: comment.text, notify_all: false };
    const created = await this.#request<{ id: string | number }>(
      'POST',
      `/task/${encodeURIComponent(taskId)}/comment`,
      taskIdQuery(s, taskId),
      { body },
    );
    return { id: String(created!.id) };
  }

  async createTask(
    settings: ClickUpSettings | null,
    listId: string,
    task: { name: string; description: string; parentId?: string | null },
  ): Promise<{ id: string; url: string }> {
    required(settings);
    const body = {
      name: task.name,
      markdown_content: task.description,
      ...(task.parentId ? { parent: task.parentId } : {}),
    };
    const created = await this.#request<RawTask>(
      'POST',
      `/list/${encodeURIComponent(listId)}/task`,
      new URLSearchParams(),
      { body },
    );
    return { id: created!.id, url: created!.url };
  }

  async #request<T>(
    method: 'GET' | 'POST',
    path: string,
    query: URLSearchParams,
    options: { body?: unknown; notFound?: boolean } = {},
  ): Promise<T | null> {
    const search = query.size ? `?${query}` : '';
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}${search}`, {
        method,
        headers: {
          authorization: this.#apiKey,
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      throw new IntegrationError(CLICKUP_ERROR, { status: null }, { cause: error });
    }
    if (response.status === 401) throw new IntegrationError(CLICKUP_AUTH_FAILED);
    if (response.status === 404 && options.notFound) return null;
    if (!response.ok) throw new IntegrationError(CLICKUP_ERROR, { status: response.status });
    return (await response.json()) as T;
  }
}

/** Every call fails with `clickup_not_configured`; used when `CLICKUP_API_KEY` is missing. */
export class UnconfiguredClickUpGateway implements ClickUpGateway {
  readonly missing: string[];

  constructor(missing: string[] = [...CLICKUP_ENV]) {
    this.missing = missing;
  }

  getTask(): Promise<ClickUpTask | null> {
    return this.#fail();
  }
  findTaskMentioningPr(): Promise<ClickUpTask | null> {
    return this.#fail();
  }
  createComment(): Promise<{ id: string }> {
    return this.#fail();
  }
  createTask(): Promise<{ id: string; url: string }> {
    return this.#fail();
  }

  #fail(): Promise<never> {
    return Promise.reject(new IntegrationNotConfiguredError(CLICKUP_NOT_CONFIGURED, this.missing));
  }
}

/** The gateway for `CLICKUP_API_KEY`; without it, the unconfigured gateway. */
export function createClickUpGateway(env: NodeJS.ProcessEnv = process.env): ClickUpGateway {
  return env.CLICKUP_API_KEY
    ? new HttpClickUpGateway({ apiKey: env.CLICKUP_API_KEY })
    : new UnconfiguredClickUpGateway();
}

/** A repository without ClickUp settings fails before any request. */
function required(settings: ClickUpSettings | null): ClickUpSettings {
  if (!settings?.workspaceId) {
    throw new IntegrationNotConfiguredError(CLICKUP_NOT_CONFIGURED, ['RepositoryConfig.clickup']);
  }
  return settings;
}

/** Custom ids (`WB-123`) need `custom_task_ids` and the workspace id. */
function taskIdQuery(settings: ClickUpSettings, id: string): URLSearchParams {
  return isCustomTaskId(id)
    ? new URLSearchParams({ custom_task_ids: 'true', team_id: settings.workspaceId })
    : new URLSearchParams();
}

function toTask(raw: RawTask): ClickUpTask {
  return {
    id: raw.id,
    customId: raw.custom_id ?? null,
    name: raw.name,
    description: descriptionOf(raw),
    url: raw.url,
    status: raw.status?.status ?? null,
    listId: raw.list?.id ?? null,
  };
}

function descriptionOf(raw: RawTask): string {
  return raw.markdown_description ?? raw.description ?? '';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
