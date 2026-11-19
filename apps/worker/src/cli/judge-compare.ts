// `pnpm judge:compare --models <a>,<b> [--limit N] [--yes]` (P-26): replays the stored judge
// calls of recent PRs on each model and prints agreement, accuracy against the types people
// forced, cost and latency. The database is read in a read-only transaction and blobs are only
// read. Without `--yes` it prints the number of calls and stops: real calls cost money.
import { createAnthropicJudge, createOpenRouterJudge, judgeInputFromMessage } from '@pra/agents';
import { isOpenRouterModel } from '@pra/core';
import { closeDb, createDb, judgeSamples, readOnly } from '@pra/db';
import { createBlobStore } from '@pra/integrations';
import {
  formatReport,
  parseCompareArgs,
  planText,
  runComparison,
  summarize,
  USAGE,
  type LoadedSample,
} from '../judge-compare/compare.ts';

const write = (text: string) => process.stdout.write(text);

const parsed = parseCompareArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${parsed.message}\n\n${USAGE}`);
  process.exit(1);
}
const { models, limit, yes } = parsed.args;
const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL is not set (see .env.example)\n');
  process.exit(1);
}

const db = createDb(url, { max: 1 });
try {
  const samples = await readOnly(db, (tx) => judgeSamples(tx, { limit }));
  write(planText(samples, models));
  if (samples.length === 0) {
    write('Nothing to compare: no stored judge calls yet.\n');
  } else if (!yes) {
    write('No calls made. Real calls cost money: run again with --yes to make them.\n');
  } else {
    const blobStore = createBlobStore();
    const loaded: LoadedSample[] = [];
    for (const sample of samples) {
      const blob = await blobStore.get(sample.promptBlobKey);
      const message = blob ? judgeInputFromMessage(Buffer.from(blob.body).toString('utf8')) : null;
      if (message) loaded.push({ ...sample, message });
    }
    if (loaded.length < samples.length) {
      write(`${samples.length - loaded.length} stored message(s) could not be read; skipped.\n`);
    }
    const claude = createAnthropicJudge();
    const openRouter = createOpenRouterJudge();
    const calls = await runComparison({
      samples: loaded,
      models,
      judgeFor: (model) => (isOpenRouterModel(model) ? openRouter : claude),
      onCall: (call, done, total) =>
        write(
          `[${done}/${total}] PR ${call.pullRequestId} ${call.model}: ` +
            `${call.judged ?? `failed (${call.error})`} · ${Math.round(call.durationMs)} ms\n`,
        ),
    });
    write(formatReport(summarize(loaded, models, calls)));
  }
} finally {
  await closeDb(db);
}
