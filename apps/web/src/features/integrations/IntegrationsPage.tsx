import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleSlash, FolderGit2, Info, Plug } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { copy } from '@/copy/index.ts';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from '@/features/settings/use-settings-form.ts';
import { ApiError } from '@/lib/api.ts';
import type { IntegrationSettings, IntegrationsResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { integrationsQuery, useClickUpTest, useIntegrationSettingsChange } from './queries.ts';

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
          <p role="alert" className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : (
        <>
          <GitHubCard github={data.github} />
          <CommentCard settings={data.settings} />
          <ClickUpCard clickup={data.clickup} />
        </>
      )}
    </SettingsPage>
  );
}

function GitHubCard({ github }: { github: IntegrationsResponse['github'] }) {
  const g = t.github;
  const { deliveries } = github;
  return (
    <Card
      title={g.title}
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

function Card(props: { title: string; status?: Status; children: ReactNode }) {
  const label = props.status ? STATUS_LABEL[props.status] : null;
  return (
    <section aria-label={props.title} className="rounded-lg border border-border bg-surface">
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
