import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import type { InstructionsListResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { instructionsQuery } from './queries.ts';

const t = copy.instructions;
type FileRow = InstructionsListResponse['files'][number];

/** The heading of a file's group: global, one repository or one level copy. */
function groupName(file: Pick<FileRow, 'scope' | 'repository' | 'level'>): string {
  if (file.scope === 'repository') return t.groups.repository(file.repository?.slug ?? '');
  if (file.scope === 'level') return t.groups.level(file.level ?? 0);
  return t.groups.global;
}

/** Settings → Instructions (FR-079): files grouped by scope, each with its active version and draft. */
export function InstructionsPage() {
  const query = useQuery(instructionsQuery());
  const data = query.data;

  // The api lists global files first, then repository copies, then level copies.
  const groups: { name: string; files: FileRow[] }[] = [];
  for (const file of data?.files ?? []) {
    const name = groupName(file);
    const group = groups.at(-1);
    if (group?.name === name) group.files.push(file);
    else groups.push({ name, files: [file] });
  }

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
      ) : groups.length === 0 ? (
        <p data-work-start className="text-text-3">
          {t.empty}
        </p>
      ) : (
        groups.map((group, index) => (
          <section
            key={group.name}
            aria-label={group.name}
            data-work-start={index === 0 ? '' : undefined}
            className="flex flex-col gap-2"
          >
            <h2 className="text-sm font-semibold text-text-2">{group.name}</h2>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t.groupLabel(group.name)}</caption>
                <thead className="bg-surface-2 text-xs text-text-3">
                  <tr>
                    {[t.columns.file, t.columns.active, t.columns.draft, t.columns.note].map(
                      (c) => (
                        <th key={c} scope="col" className="px-3 py-2 font-semibold">
                          {c}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {group.files.map((file) => (
                    <tr key={file.id} className="border-t border-divider">
                      <th scope="row" className="px-3 py-2 font-medium">
                        <Link
                          to="/settings/instructions/$id"
                          params={{ id: String(file.id) }}
                          className="font-mono text-[13px] text-brand-text hover:underline"
                        >
                          {file.fileKey}
                        </Link>
                      </th>
                      <td className="px-3 py-2">
                        {file.active ? t.version(file.active.version) : t.none}
                      </td>
                      <td className="px-3 py-2">
                        {file.draft ? t.version(file.draft.version) : t.none}
                      </td>
                      <td className="px-3 py-2 text-text-2">
                        {(file.draft ?? file.active)?.note ?? t.none}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </SettingsPage>
  );
}
