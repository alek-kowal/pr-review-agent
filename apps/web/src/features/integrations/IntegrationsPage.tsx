import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleSlash, FolderGit2, Info, Plug, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { copy } from '@/copy/index.ts';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from '@/features/settings/use-settings-form.ts';
import { ApiError } from '@/lib/api.ts';
import type {
  GitHubMode,
  GitHubPoller,
  GitHubPollSchedule,
  IntegrationSettings,
  IntegrationsResponse,
} from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { pollErrorText } from './poll-error.ts';
import {
  integrationsQuery,
  useClickUpTest,
  useIntegrationSettingsChange,
  usePollNow,
  usePollScheduleChange,
} from './queries.ts';

const t = copy.integrations;

const FIELDS: readonly SettingsField<IntegrationSettings>[] = [
  {
    key: 'afterRoundGithubComment',
    label: t.comment.field,
    format: (on) => (on ? t.on : t.off),
  },
];

/**
 * Settings → Integrations (FR-079): GitHub App and ClickUp health, a ClickUp connection test, and
 * the after-round GitHub comment switch. Missing credentials read "Not configured".
 */
export function IntegrationsPage() {
  const query = useQuery(integrationsQuery());
  const data = query.data;

  return (
    <SettingsPage title={t.title} affects={t.affects}>
      {!data ? (
        query.isError ? (
          <p role="alert" data-work-start className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : (
        <>
          {data.github.poller && <PollerCard mode={data.github.mode} poller={data.github.poller} />}
          <GitHubCard github={data.github} workStart={!data.github.poller} />
          <CommentCard settings={data.settings} />
          <ClickUpCard clickup={data.clickup} />
        </>
      )}
    </SettingsPage>
  );
}

const p = t.poller;
const s = p.schedule;
const days = (list: readonly number[]) => list.map((d) => p.dayNames[d - 1]).join(', ');

const SCHEDULE_FIELDS: readonly SettingsField<GitHubPollSchedule>[] = [
  { key: 'intervalMinutes', label: s.fieldInterval, format: (v) => s.minutes(Number(v)) },
  { key: 'from', label: s.from, format: String },
  { key: 'to', label: s.to, format: String },
  { key: 'days', label: s.fieldDays, format: (v) => days(v as number[]) },
  { key: 'timeZone', label: s.fieldTimeZone, format: String },
];

/** Without the GitHub App (P-28): how the poller finds PRs, its health and its schedule. */
function PollerCard({ mode, poller }: { mode: GitHubMode; poller: GitHubPoller }) {
  const pollNow = usePollNow();
  const error = poller.lastError;
  const at = (iso: string) => new Date(iso).toLocaleString();
  return (
    <Card title={p.title} workStart>
      <p role="note" className="text-text-2">
        {p.readOnly}
      </p>
      <Row label={p.mode}>{p.modes[mode] ?? mode}</Row>
      <Row label={p.lastPoll}>
        {poller.lastStartedAt ? (
          <Time iso={poller.lastStartedAt} />
        ) : (
          <span className="text-text-3">{p.neverPolled}</span>
        )}
      </Row>
      <Row label={p.nextPoll}>
        <Time iso={poller.nextPollAt} />
        {!poller.windowOpen && <span className="text-text-3"> · {p.windowClosed}</span>}
      </Row>
      <Row label={p.lastError}>
        {!error ? (
          <span className="text-text-3">{p.noError}</span>
        ) : (
          <span className="text-bad">{pollErrorText(error)}</span>
        )}
      </Row>
      <Row label={p.rateLimit}>
        {poller.rateLimit ? (
          <span>
            {p.rateLimitLeft(
              poller.rateLimit.remaining,
              poller.rateLimit.limit,
              at(poller.rateLimit.resetAt),
            )}
          </span>
        ) : (
          <span className="text-text-3">{p.noRateLimit}</span>
        )}
        {mode === 'anonymous' && (
          <p role="status" className="mt-1 text-warn">
            {p.anonymousWarning}
          </p>
        )}
      </Row>
      <Row label={p.repositories}>
        {poller.repositories.length === 0 ? (
          <span className="text-text-3">{p.noRepositories}</span>
        ) : (
          <ul className="grid gap-1">
            {poller.repositories.map((r) => (
              <li key={r.fullName} className="flex flex-wrap items-center gap-1.5">
                <FolderGit2 aria-hidden="true" className="size-3.5 text-text-3" />
                <span className="font-mono text-[13px]">{r.fullName}</span>
                <span className="text-xs text-text-3">
                  · {p.repository(r.openCount)} ·{' '}
                  {r.baselineAt ? p.baselinedAt(at(r.baselineAt)) : p.notBaselined}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-text-3">{p.baselineNote}</p>
      </Row>
      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pollNow.isPending}
          onClick={() => pollNow.mutate()}
        >
          <RefreshCw aria-hidden="true" />
          {pollNow.isPending ? p.polling : p.pollNow}
        </Button>
        <p role="status" className="text-sm">
          {pollNow.data && (pollNow.data.queued ? p.pollQueued : p.pollWaiting)}
          {pollNow.isError && (
            <span className="text-bad">
              {p.pollFailedToQueue(
                errorText(pollNow.error instanceof ApiError ? pollNow.error.code : 'http_error'),
              )}
            </span>
          )}
        </p>
      </div>
      <PollSchedule schedule={poller.schedule} />
    </Card>
  );
}

function PollSchedule({ schedule }: { schedule: GitHubPollSchedule }) {
  const form = useSettingsForm(schedule, SCHEDULE_FIELDS);
  const change = usePollScheduleChange();
  const [open, setOpen] = useState(false);
  const draft = form.draft;
  return (
    <fieldset className="grid gap-3 rounded-md border border-divider p-3">
      <legend className="px-1 font-medium">{s.title}</legend>
      <p className="text-xs text-text-3">{s.hint}</p>
      <div className="flex flex-wrap gap-3">
        <Field label={s.interval} id="poll-interval">
          <Input
            id="poll-interval"
            type="number"
            min={1}
            max={240}
            className="w-24"
            value={draft.intervalMinutes}
            onChange={(e) => form.set('intervalMinutes', Number(e.target.value))}
          />
        </Field>
        <Field label={s.from} id="poll-from">
          <Input
            id="poll-from"
            type="time"
            className="w-32"
            value={draft.from}
            onChange={(e) => form.set('from', e.target.value)}
          />
        </Field>
        <Field label={s.to} id="poll-to">
          <Input
            id="poll-to"
            type="time"
            className="w-32"
            value={draft.to}
            onChange={(e) => form.set('to', e.target.value)}
          />
        </Field>
        <Field label={s.timeZone} id="poll-zone">
          <Input
            id="poll-zone"
            className="w-48"
            value={draft.timeZone}
            onChange={(e) => form.set('timeZone', e.target.value)}
          />
        </Field>
      </div>
      <div role="group" aria-label={s.days} className="flex flex-wrap gap-3">
        {p.dayNames.map((name, i) => {
          const day = i + 1;
          const on = draft.days.includes(day);
          return (
            <label key={name} className="flex items-center gap-1.5">
              <Checkbox
                checked={on}
                onCheckedChange={(checked) =>
                  form.set(
                    'days',
                    checked === true
                      ? [...draft.days, day].sort((a, b) => a - b)
                      : draft.days.filter((d) => d !== day),
                  )
                }
              />
              {name}
            </label>
          );
        })}
      </div>
      <SaveBar count={form.changes.length} onDiscard={form.discard} onSave={() => setOpen(true)} />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={s.saveTitle}
        changes={form.changes}
        onConfirm={(signedBy) => change.mutateAsync({ before: schedule, after: draft, signedBy })}
      />
    </fieldset>
  );
}

function Field(props: { label: string; id: string; children: ReactNode }) {
  return (
    <span className="grid gap-1">
      <label htmlFor={props.id} className="text-xs text-text-2">
        {props.label}
      </label>
      {props.children}
    </span>
  );
}

function GitHubCard({
  github,
  workStart,
}: {
  github: IntegrationsResponse['github'];
  workStart: boolean;
}) {
  const g = t.github;
  const { deliveries } = github;
  return (
    <Card
      title={g.title}
      workStart={workStart}
      status={!github.configured ? 'notConfigured' : github.listError ? 'unreachable' : 'connected'}
    >
      {!github.configured && <Missing names={github.missing} />}
      {github.configured && (
        <>
          {github.listError && (
            <p className="text-sm text-bad">{g.listError(errorText(github.listError.code))}</p>
          )}
          <Row label={g.installations}>
            {github.installations.length === 0 ? (
              <span className="text-text-3">{g.noInstallations}</span>
            ) : (
              <ul className="grid gap-1">
                {github.installations.map((i) => (
                  <li key={i.id}>{g.installation(i.account, i.repositoryCount)}</li>
                ))}
              </ul>
            )}
          </Row>
          <Row label={g.repositories} hint={g.repositoriesHint}>
            {github.repositories.length === 0 ? (
              <span className="text-text-3">{g.noRepositories}</span>
            ) : (
              <ul className="grid gap-1">
                {github.repositories.map((r) => (
                  <li key={r.fullName} className="flex items-center gap-1.5">
                    <FolderGit2 aria-hidden="true" className="size-3.5 text-text-3" />
                    <span className="font-mono text-[13px]">{r.fullName}</span>
                    {r.private && <span className="text-xs text-text-3">· {g.private}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Row>
        </>
      )}
      <Row label={g.webhooks} hint={g.webhooksHint}>
        <ul className="grid gap-1">
          <li>
            {g.lastDelivery}:{' '}
            {deliveries.last ? (
              <>
                <Time iso={deliveries.last.receivedAt} />{' '}
                <span className="font-mono text-[13px] text-text-2">
                  ({g.delivery(deliveries.last.event, deliveries.last.action)})
                </span>
              </>
            ) : (
              <span className="text-text-3">{g.noDelivery}</span>
            )}
          </li>
          <li>{g.deliveries24h(deliveries.last24h)}</li>
          <li className={cn(deliveries.signatureFailures24h > 0 && 'text-bad')}>
            {g.failures24h(deliveries.signatureFailures24h)}
          </li>
        </ul>
      </Row>
      <Row label={g.reconcile}>
        {github.lastReconcilePoll ? (
          <Time iso={github.lastReconcilePoll} />
        ) : (
          <span className="text-text-3">{g.noReconcile}</span>
        )}
      </Row>
    </Card>
  );
}

function CommentCard({ settings }: { settings: IntegrationSettings }) {
  const c = t.comment;
  const form = useSettingsForm(settings, FIELDS);
  const change = useIntegrationSettingsChange();
  const [open, setOpen] = useState(false);
  const on = form.draft.afterRoundGithubComment;
  return (
    <Card title={c.title}>
      <Row label={c.label} hint={c.hint} htmlFor="after-round-comment">
        <span className="flex items-center gap-2">
          <Switch
            id="after-round-comment"
            checked={on}
            onCheckedChange={(value) => form.set('afterRoundGithubComment', value)}
          />
          <span>{on ? t.on : t.off}</span>
        </span>
        <code className="mt-2 block w-fit rounded bg-surface-2 px-2 py-1 font-mono text-[13px]">
          {c.example}
        </code>
        <p className="mt-1 text-xs text-text-3">{c.note}</p>
      </Row>
      <SaveBar count={form.changes.length} onDiscard={form.discard} onSave={() => setOpen(true)} />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={c.saveTitle}
        changes={form.changes}
        onConfirm={(signedBy) =>
          change.mutateAsync({ before: settings, after: form.draft, signedBy })
        }
      />
    </Card>
  );
}

function ClickUpCard({ clickup }: { clickup: IntegrationsResponse['clickup'] }) {
  const c = t.clickup;
  const test = useClickUpTest();
  const result = test.data;
  const call = clickup.lastCall;
  return (
    <Card title={c.title} status={clickup.configured ? 'connected' : 'notConfigured'}>
      {!clickup.configured && <Missing names={clickup.missing} />}
      <Row label={c.lastCall} hint={c.hint}>
        {call ? (
          <span>
            <Time iso={call.at} />:{' '}
            {call.ok ? (
              c.callOk
            ) : (
              <span className="text-bad">
                {c.callFailed(errorText(call.error?.code ?? 'clickup_error'))}
              </span>
            )}
          </span>
        ) : (
          <span className="text-text-3">{c.noCall}</span>
        )}
      </Row>
      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          <Plug aria-hidden="true" />
          {test.isPending ? c.testing : c.test}
        </Button>
        <p role="status" className="text-sm">
          {result?.ok === true && <span className="text-ok">{c.testOk(result.user.username)}</span>}
          {result?.ok === false && (
            <span className="text-bad">{c.testFailed(errorText(result.error.code))}</span>
          )}
          {test.isError && (
            <span className="text-bad">
              {c.testFailed(
                errorText(test.error instanceof ApiError ? test.error.code : 'http_error'),
              )}
            </span>
          )}
        </p>
      </div>
    </Card>
  );
}

type Status = 'connected' | 'notConfigured' | 'unreachable';

const STATUS_LABEL: Record<Status, string> = {
  connected: t.connected,
  notConfigured: t.notConfigured,
  unreachable: t.unreachable,
};

function Card(props: {
  title: string;
  status?: Status;
  /** The page's first card: where its work starts (`data-work-start`). */
  workStart?: boolean;
  children: ReactNode;
}) {
  const label = props.status ? STATUS_LABEL[props.status] : null;
  return (
    <section
      aria-label={props.title}
      data-work-start={props.workStart ? '' : undefined}
      className="rounded-lg border border-border bg-surface"
    >
      <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-2.5">
        <h2 className="text-sm font-semibold">{props.title}</h2>
        {label && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
              props.status === 'connected' ? 'border-ok/40 text-ok' : 'border-bad/40 text-bad',
            )}
          >
            {props.status === 'connected' ? (
              <CircleCheck aria-hidden="true" className="size-3.5" />
            ) : (
              <CircleSlash aria-hidden="true" className="size-3.5" />
            )}
            {label}
          </span>
        )}
      </header>
      <div className="flex flex-col gap-4 px-4 py-4 text-sm">{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  const Label = props.htmlFor ? 'label' : 'span';
  return (
    <div className="grid gap-1.5 md:grid-cols-[minmax(180px,260px)_1fr] md:gap-4">
      <span className="flex items-start gap-1.5 font-medium">
        <Label htmlFor={props.htmlFor}>{props.label}</Label>
        {props.hint && (
          <span title={props.hint} className="mt-0.5 text-text-3">
            <Info aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{props.hint}</span>
          </span>
        )}
      </span>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

function Missing({ names }: { names: string[] }) {
  return <p className="text-text-2">{t.missing(names)}</p>;
}

function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
}
