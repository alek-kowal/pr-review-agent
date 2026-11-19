// S-04-T6: Run detail's view of the Checks and Change type stage outputs.
import { copy } from '@/copy/index.ts';
import { isRecord, str } from '@/features/runs/output-values.ts';
import { GenericOutput, Kv } from '@/features/runs/StageOutputs.tsx';
import type { StageOutputProps } from '@/features/runs/stage-outputs.ts';

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** The Checks stage: CI counts on the round's head and the install result. */
export function ChecksOutput({ output }: StageOutputProps) {
  if (!isRecord(output) || !isRecord(output.ci) || !isRecord(output.install)) {
    return <GenericOutput output={output} />;
  }
  const t = copy.checks;
  const ci = {
    passed: num(output.ci.passed),
    failed: num(output.ci.failed),
    pending: num(output.ci.pending),
  };
  const anyCi = ci.passed + ci.failed + ci.pending > 0;
  const status = str(output.install.status) ?? '';
  const step =
    output.install.failedStep === 'fetch' ? output.install.fetch : output.install.install;
  const exitCode = isRecord(step) && typeof step.exitCode === 'number' ? step.exitCode : null;
  return (
    <div data-testid="checks-output">
      <Kv
        rows={[
          [t.ci.label, anyCi ? t.ci.counts(ci) : t.ci.none],
          [
            t.install.label,
            <>
              {t.install.status(status)}
              {exitCode !== null && (
                <span className="text-text-3"> · {t.install.exit(exitCode)}</span>
              )}
            </>,
          ],
        ]}
      />
    </div>
  );
}

/** The Change type stage: the type and how it was set, the rules' and the judge's answers. */
export function ChangeTypeOutput({ output }: StageOutputProps) {
  if (!isRecord(output) || !str(output.changeType)) return <GenericOutput output={output} />;
  const t = copy.checks;
  const reason = isRecord(output.reason) ? (str(output.reason.code) ?? '') : '';
  const rules = isRecord(output.rules) ? str(output.rules.changeType) : null;
  const judge = isRecord(output.judge) ? output.judge : null;
  const rows: [string, React.ReactNode][] = [
    [t.panel.title, `${t.changeType(str(output.changeType)!)} · ${t.how(reason)}`],
  ];
  if (rules) rows.push([t.output.rules, t.changeType(rules)]);
  if (judge && str(judge.changeType)) {
    rows.push([
      t.output.judge,
      <>
        {t.changeType(str(judge.changeType)!)}
        {str(judge.reason) && <span className="text-text-3"> · {str(judge.reason)}</span>}
      </>,
    ]);
  } else if (isRecord(output.judgeSkipped)) {
    rows.push([t.output.judge, t.output.judgeSkipped]);
  }
  rows.push([t.output.lines, String(num(output.lines))]);
  return (
    <div className="flex flex-col gap-2" data-testid="change-type-output">
      <Kv rows={rows} />
      {output.largePr === true && (
        <p className="text-sm text-warn" data-testid="large-pr-warning">
          {t.largePr.text(num(output.lines), num(output.largePrLines))}
        </p>
      )}
    </div>
  );
}
