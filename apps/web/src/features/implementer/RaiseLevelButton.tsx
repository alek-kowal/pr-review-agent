import { TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { FEATURE_ON_FROM } from '@pra/core';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { useSetPrLevel } from './implement.ts';

const t = copy.implementer;

/** "Raise this PR to level 4": the PR's own level, unsigned (recorded "by hand"). */
export function RaiseLevelButton({ repo, number }: { repo: string; number: string }) {
  const setLevel = useSetPrLevel(repo, number);
  const need = FEATURE_ON_FROM.implement;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={setLevel.isPending}
      onClick={() =>
        setLevel.mutate(need, {
          onSuccess: () => toast.success(t.raised(need)),
          onError: (error) =>
            toast.error(errorText(error instanceof ApiError ? error.code : 'http_error')),
        })
      }
    >
      <TrendingUp aria-hidden="true" className="size-[13px]" />
      {t.raiseLevel(need)}
    </Button>
  );
}
