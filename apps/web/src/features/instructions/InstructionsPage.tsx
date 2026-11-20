import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import type { InstructionsListResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { InstructionGaps } from './InstructionGaps.tsx';
import { NewFileDialog } from './NewFileDialog.tsx';
import { instructionsQuery } from './queries.ts';

const t = copy.instructions;
type FileRow = InstructionsListResponse['files'][number];
const SECTIONS = ['instruction', 'document'] as const;

/** Where a file lives: Global, a repository's slug or a level copy. */
function scopeName(file: Pick<FileRow, 'scope' | 'repository' | 'level'>): string {
  if (file.scope === 'repository') return t.scope.repository(file.repository?.slug ?? '');
  if (file.scope === 'level') return t.scope.level(file.level ?? 0);
  return t.scope.global;
}

/** One line on what a file is for, when the key is a known one. */
function aboutFile(fileKey: string): string | null {
  const known = t.about[fileKey];
  if (known) return known;
  if (fileKey.startsWith('feature-map/')) return t.aboutFeatureMap;
  const prompt = /^prompt-([a-z]+)\.md$/.exec(fileKey);
  return prompt ? t.aboutPrompt(prompt[1]!) : null;
}

/**
 * Settings → Instructions (FR-079, STAGEFILES): Instructions (prompts, rules) apart from Documents
 * (reference material), each file with its scope, the stages that read it, its active version and
 * draft. Files no stage reads hide behind a toggle; New file starts a draft.
 */
export function InstructionsPage() {
  const query = useQuery(instructionsQuery());
  const data = query.data;
  const [showUnused, setShowUnused] = useState(false);
  const [creating, setCreating] = useState(false);
  const unused = data?.files.filter((f) => f.readBy.length === 0).length ?? 0;

  return (
    <SettingsPage
      title={t.title}
      affects={t.affects}
      actions={
        data && (
          <Button type="button" onClick={() => setCreating(true)}>
            {t.newFile.open}
          </Button>
        )
      }
    >
      {data && <InstructionGaps gaps={data.gaps} />}
      {!data ? (
        query.isError ? (
          <p role="alert" data-work-start className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : data.files.length === 0 ? (
        <p data-work-start className="text-text-3">
          {t.empty}
        </p>
      ) : (
        <>
          {SECTIONS.map((kind, index) => (
            <FileSection
              key={kind}
              kind={kind}
              first={index === 0}
              files={data.files.filter(
                (f) => f.kind === kind && (showUnused || f.readBy.length > 0),
              )}
            />
          ))}
          {unused > 0 && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={showUnused}
                onClick={() => setShowUnused((on) => !on)}
              >
                {showUnused ? t.hideUnused : t.showUnused(unused)}
              </Button>
            </div>
          )}
        </>
      )}
      {data && (
        <NewFileDialog
          open={creating}
          onOpenChange={setCreating}
          repositories={data.repositories}
        />
      )}
    </SettingsPage>
  );
}

function FileSection({
  kind,
  first,
  files,
}: {
  kind: (typeof SECTIONS)[number];
  first: boolean;
  files: FileRow[];
}) {
  const section = t.sections[kind]!;
  const c = t.columns;
  const stages = copy.pipeline.stages;
  return (
    <section
      aria-label={section.title}
      data-work-start={first ? '' : undefined}
      className="flex flex-col gap-2"
    >
      <div>
        <h2 className="text-sm font-semibold text-text-2">{section.title}</h2>
        <p className="text-xs text-text-3">{section.hint}</p>
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-text-3">{t.sectionEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t.sectionLabel(section.title)}</caption>
            <thead className="bg-surface-2 text-xs text-text-3">
              <tr>
                {[c.file, c.scope, c.readBy, c.active, c.draft].map((name) => (
                  <th key={name} scope="col" className="px-3 py-2 font-semibold">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const about = aboutFile(file.fileKey);
                return (
                  <tr key={file.id} className="border-t border-divider align-top">
                    <th scope="row" className="px-3 py-2 font-medium">
                      <Link
                        to="/settings/instructions/$id"
                        params={{ id: String(file.id) }}
                        className="font-mono text-[13px] text-brand-text hover:underline"
                      >
                        {file.fileKey}
                      </Link>
                      {about && (
                        <span className="block text-xs font-normal text-text-3">{about}</span>
                      )}
                    </th>
                    <td className="px-3 py-2">{scopeName(file)}</td>
                    <td className="px-3 py-2">
                      {file.readBy.length === 0 ? (
                        <span className="text-text-3">{t.notUsed}</span>
                      ) : (
                        file.readBy
                          .map((r) => t.readBy(stages[r.stage] ?? r.stage, r.repository))
                          .join(', ')
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {file.active ? t.version(file.active.version) : t.none}
                    </td>
                    <td className="px-3 py-2">
                      {file.draft ? t.version(file.draft.version) : t.none}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
