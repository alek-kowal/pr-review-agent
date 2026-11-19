// S-08-T10 (FR-039): the ClickUp comment Notify author posts after a signed review. It is the bot's
// output in ClickUp, not app copy: the api previews and posts this one string, so what the card
// shows is exactly what is posted.

export type NotifyTextInput = {
  /** The PR author's Team name (else their GitHub login). */
  author: string;
  /** Who signed the review. */
  signer: string;
  worth: number;
  notWorth: number;
  prNumber: number;
};

const findings = (count: number) => `${count} ${count === 1 ? 'finding' : 'findings'}`;

/**
 * "@Kasia: Tomek marked 2 findings as worth implementing and 1 finding as not worth it in PR
 * #272". A zero count is left out.
 */
export function notifyText(input: NotifyTextInput): string {
  const parts = [
    input.worth > 0 && `${findings(input.worth)} as worth implementing`,
    input.notWorth > 0 && `${findings(input.notWorth)} as not worth it`,
  ].filter(Boolean);
  return `@${input.author}: ${input.signer} marked ${parts.join(' and ')} in PR #${input.prNumber}`;
}
