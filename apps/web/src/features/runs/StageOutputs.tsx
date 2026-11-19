import { copy } from '@/copy/index.ts';
import type { StageOutputProps } from './stage-outputs.ts';

import { isRecord, str } from './output-values.ts';

/** Keys and values of a stage output, two columns. */
export function Kv({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-text-3">{key}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The Task stage: the linked ClickUp task with its text, or why there is none. */
export function TaskOutput({ output }: StageOutputProps) {
  if (!isRecord(output)) return <GenericOutput output={output} />;
  if (output.status !== 'linked' || !isRecord(output.task)) {
    const code = isRecord(output.reason) ? str(output.reason.code) : null;
    return (
      <p className="text-sm text-text-2">
        {(code && copy.clickup.noTask[code]) ?? copy.clickup.noTask.no_task_linked}
      </p>
    );
  }
  const task = output.task;
  const id = str(task.customId) ?? str(task.id) ?? '';
  const how = str(output.how);
  const description = str(task.description);
  return (
    <div className="flex flex-col gap-2" data-testid="task-output">
      <Kv
        rows={[
          [
            copy.clickup.taskLabel,
            <>
              <a href={str(task.url) ?? '#'} target="_blank" rel="noopener noreferrer">
                {id}
              </a>{' '}
              {str(task.name)}
              {how && copy.clickup.how[how] && (
                <span className="text-text-3"> · {copy.clickup.how[how]}</span>
              )}
              {str(task.status) && (
                <span className="text-text-3"> · {copy.clickup.taskStatus(str(task.status)!)}</span>
              )}
            </>,
          ],
        ]}
      />
      <div>
        <p className="text-xs text-text-3">{copy.clickup.description}</p>
        <p className="mt-0.5 text-sm whitespace-pre-wrap">
          {description || copy.clickup.noDescription}
        </p>
      </div>
    </div>
  );
}

/** The Review stage: the reviewer's summary and what it reported. */
export function ReviewOutput({ output }: StageOutputProps) {
  if (!isRecord(output)) return <GenericOutput output={output} />;
  const reported = isRecord(output.reported) ? output.reported : {};
  const dropped = Array.isArray(output.dropped) ? output.dropped.length : 0;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {str(output.summary) && <p className="whitespace-pre-wrap">{str(output.summary)}</p>}
      <Kv
        rows={[
          ...(str(output.risk)
            ? [[copy.runs.outputs.risk, str(output.risk)] as [string, string]]
            : []),
          [
            copy.runs.outputs.reported,
            copy.runs.outputs.reportedValue(
              Number(reported.findings) || 0,
              Number(reported.questions) || 0,
            ),
          ],
          ...(dropped > 0
            ? [[copy.runs.outputs.dropped, String(dropped)] as [string, string]]
            : []),
        ]}
      />
    </div>
  );
}

/** Any other stage: its stored output as keys and values. */
export function GenericOutput({ output }: Pick<StageOutputProps, 'output'>) {
  if (output === null || output === undefined) {
    return <p className="text-sm text-text-3">{copy.runs.detail.noOutput}</p>;
  }
  if (!isRecord(output)) return <pre className="text-xs whitespace-pre-wrap">{String(output)}</pre>;
  return (
    <Kv
      rows={Object.entries(output).map(([key, value]) => [
        key,
        typeof value === 'string' ? (
          value
        ) : (
          <code className="text-xs">{JSON.stringify(value)}</code>
        ),
      ])}
    />
  );
}
