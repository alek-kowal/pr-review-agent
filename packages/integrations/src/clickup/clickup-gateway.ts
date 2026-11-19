/** Everything the app asks of ClickUp. Every call takes the repository's ClickUp settings first. */
export interface ClickUpGateway {
  /** A task by its ClickUp id or custom id (e.g. `WB-123`); `null` when it does not exist. */
  getTask(settings: ClickUpSettings | null, id: string): Promise<ClickUpTask | null>;
  /**
   * The search fallback: a recently updated task whose description links the PR (the team's
   * convention), or `null`.
   */
  findTaskMentioningPr(
    settings: ClickUpSettings | null,
    prUrl: string,
  ): Promise<ClickUpTask | null>;
  createComment(
    settings: ClickUpSettings | null,
    taskId: string,
    comment: { text: string; mentionUserId?: string | null },
  ): Promise<{ id: string }>;
  /** A follow-up task in `listId`; `parentId` (a ClickUp task id) makes it a subtask. */
  createTask(
    settings: ClickUpSettings | null,
    listId: string,
    task: { name: string; description: string; parentId?: string | null },
  ): Promise<{ id: string; url: string }>;
}

/**
 * The repository's ClickUp settings the gateway needs (`RepositoryConfig.clickup`). `null`: the
 * repository has no ClickUp, and every call fails with `clickup_not_configured`.
 */
export type ClickUpSettings = {
  /** ClickUp's workspace (team) id. */
  workspaceId: string;
  /** Narrows the PR search to one space; null searches the whole workspace. */
  spaceId?: string | null;
};

export type ClickUpTask = {
  id: string;
  customId: string | null;
  name: string;
  /** Markdown. */
  description: string;
  url: string;
  status: string | null;
  listId: string | null;
};

export const CLICKUP_ENV = ['CLICKUP_API_KEY'] as const;
/** No key, or the repository has no ClickUp settings. Thrown before any request. */
export const CLICKUP_NOT_CONFIGURED = 'clickup_not_configured';
/** ClickUp rejected the key (401). */
export const CLICKUP_AUTH_FAILED = 'clickup_auth_failed';
/** Any other failure; `params.status` is the HTTP status, or null when no answer came. */
export const CLICKUP_ERROR = 'clickup_error';

/** ClickUp custom task ids look like `WB-123`; default ids have no dash. */
export function isCustomTaskId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id);
}
