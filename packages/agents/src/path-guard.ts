import { realpath } from 'node:fs/promises';
import * as path from 'node:path';
import type { CanUseTool, HookCallback } from '@anthropic-ai/claude-agent-sdk';

/** Where a session may look and where it may write. */
export type PathPolicy = {
  /** The session's working directory: readable and, for roles that edit, writable. */
  cwd: string;
  /** Extra read-only directories. */
  readDirs: readonly string[];
};

export type PathDecision = { allowed: true } | { allowed: false; reason: string };

/** Tools that read, and the input field that names their path (absent = the `cwd`). */
const READ_TOOLS: Readonly<Record<string, string>> = {
  Read: 'file_path',
  Glob: 'path',
  Grep: 'path',
};
/** Tools that write, and the input field that names their path. */
const WRITE_TOOLS: Readonly<Record<string, string>> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};
/** Never allowed, even if a role's tool list ever named them: shells, network, sub-agents. */
const DENIED_TOOLS = new Set([
  'Bash',
  'BashOutput',
  'KillShell',
  'KillBash',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
]);
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Decides one tool call. Reads must resolve inside `cwd` or a read dir, writes inside `cwd`.
 * A path resolves through the real path of its nearest existing ancestor, so `..`, absolute paths
 * and symlinks that point out are all caught. Tools without a path (such as the SDK's own
 * structured-output tool) are left to the session's tool list.
 */
export async function checkToolPath(
  policy: PathPolicy,
  toolName: string,
  input: Record<string, unknown>,
): Promise<PathDecision> {
  if (DENIED_TOOLS.has(toolName)) return deny(`${toolName} is not allowed`);
  const writing = toolName in WRITE_TOOLS;
  const field = WRITE_TOOLS[toolName] ?? READ_TOOLS[toolName];
  if (!field) return { allowed: true };

  const raw = input[field];
  if (raw !== undefined && typeof raw !== 'string') return deny(`${field} is not a path`);
  const targets = [raw ?? '.'];
  // A glob pattern can leave its base folder (`../x/*`, `/etc/*`): check its fixed prefix too.
  if (toolName === 'Glob' && typeof input.pattern === 'string') {
    targets.push(path.join(raw ?? '.', globPrefix(input.pattern)));
    if (path.isAbsolute(input.pattern)) targets.push(globPrefix(input.pattern));
  }

  const roots = writing ? [policy.cwd] : [policy.cwd, ...policy.readDirs];
  const realRoots = await Promise.all(roots.map((root) => resolveReal(root, root)));
  for (const target of targets) {
    if (target.startsWith('~')) return deny(`${field} must not start with ~`);
    const real = await resolveReal(policy.cwd, target);
    if (!realRoots.some((root) => isInside(root, real))) {
      return deny(`${writing ? 'writes' : 'reads'} only inside the allowed folders: ${target}`);
    }
  }
  return { allowed: true };
}

/** The guard as a PreToolUse hook (every role) and as a permission callback (implementer). */
export function pathGuard(policy: PathPolicy): { hook: HookCallback; canUseTool: CanUseTool } {
  return {
    hook: async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
      const decision = await checkToolPath(policy, input.tool_name, toolInput);
      if (decision.allowed) return {};
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason,
        },
      };
    },
    canUseTool: async (toolName, input) => {
      const decision = await checkToolPath(policy, toolName, input);
      return decision.allowed
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: decision.reason };
    },
  };
}

/** `target` against `base`, through the real path of its nearest existing ancestor. */
async function resolveReal(base: string, target: string): Promise<string> {
  const absolute = path.resolve(base, target);
  const rest: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** The part of a glob pattern before its first wildcard segment. */
function globPrefix(pattern: string): string {
  const segments = pattern.split('/');
  const fixed: string[] = [];
  for (const segment of segments) {
    if (GLOB_CHARS.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.join('/') || '.';
}

function deny(reason: string): PathDecision {
  return { allowed: false, reason };
}
