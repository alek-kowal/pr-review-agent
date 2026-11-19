// Copy for the PR's ClickUp task: the Task stage output, the task panel on the PR page, linking a
// task by hand and follow-up tasks of deferred findings.

export const clickup = {
  taskLabel: 'ClickUp task',
  /** How the task was linked (`pr_task_links.how`). */
  how: {
    branch: 'found from the branch name',
    title: 'found from the PR title',
    search: 'found by a search for the PR link',
    hand: 'linked by hand',
  } as Record<string, string>,
  /** Why there is no task, by reason code. */
  noTask: {
    clickup_not_configured: 'ClickUp not configured for this repository',
    no_task_linked: 'No ClickUp task linked',
    linked_task_not_found: 'The linked task was not found in ClickUp',
  } as Record<string, string>,
  taskStatus: (status: string) => `status: ${status}`,
  description: 'Description',
  noDescription: 'The task has no description.',
  /** The task panel on the PR page. */
  panel: {
    title: 'ClickUp task',
    open: (taskId: string) => `Open ${taskId} in ClickUp`,
    linkButton: 'Link a ClickUp task',
    changeButton: 'Link another task',
  },
  /** The dialog that links a task by hand (unsigned). */
  linkDialog: {
    title: 'Link a ClickUp task',
    description: 'The next round reads this task. Recorded on the timeline as by hand.',
    field: 'Task ID or link',
    placeholder: 'WB-123 or https://app.clickup.com/t/…',
    cancel: 'Cancel',
    confirm: 'Link task',
    saving: 'Checking the task…',
  },
};
