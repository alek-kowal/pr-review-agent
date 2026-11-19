/**
 * The ClickUp task id a PR names, from its branch first and then its title. `pattern` is the
 * repository's `clickup.taskIdPattern` (a regular expression source such as `WB-\d+` or
 * `CU-[a-z0-9]+`). Matching ignores case and never matches inside a longer word or number.
 * Returns the id as written, or null.
 */
export function findTaskId(branch: string, title: string, pattern: string): string | null {
  const regex = taskIdRegex(pattern);
  for (const text of [branch, title]) {
    const match = regex.exec(text);
    if (match) return match[1]!;
  }
  return null;
}

/** Whether `pattern` is a usable task id pattern (it compiles and matches no empty string). */
export function isValidTaskIdPattern(pattern: string): boolean {
  try {
    return !taskIdRegex(pattern).test('');
  } catch {
    return false;
  }
}

function taskIdRegex(pattern: string): RegExp {
  // Letters and digits on either side mean the id is part of another word: `AWB-1`, `WB-12x`.
  return new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, 'iu');
}

// `https://app.clickup.com/t/86c1abc` or `https://app.clickup.com/t/9012/WB-123` (custom ids
// carry the workspace id first); the scheme and `app.` are optional.
const TASK_URL =
  /^(?:https?:\/\/)?(?:app\.)?clickup\.com\/t\/(?:\d+\/)?([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;
const TASK_ID = /^#?([A-Za-z0-9][A-Za-z0-9_-]*)$/;

/**
 * The task id in what a person typed to link a task: an id (`WB-123`, `86c1abc`, `#86c1abc`) or
 * a ClickUp task link. Returns null for anything else.
 */
export function taskIdFromRef(input: string): string | null {
  const text = input.trim();
  return TASK_URL.exec(text)?.[1] ?? TASK_ID.exec(text)?.[1] ?? null;
}
