import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { copy } from '@/copy/index.ts';

const t = copy.repositories.connect.byName;

/** `owner/name` as GitHub allows it. */
const REPOSITORY_NAME = /^[\w.-]+\/[\w.-]+$/;

/**
 * "Connect a repository" without the GitHub App (P-28): there is no list of reachable
 * repositories, so the person types `owner/name`; the connect page checks it with GitHub.
 */
export function ConnectByName() {
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  const navigate = useNavigate();
  const id = useId();

  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const fullName = name.trim();
        if (!REPOSITORY_NAME.test(fullName)) {
          setInvalid(true);
          return;
        }
        void navigate({ to: '/settings/repositories/connect', search: { fullName } });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="sr-only">
          {t.label}
        </label>
        <Input
          id={id}
          value={name}
          placeholder={t.placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="w-72 font-mono text-[13px]"
          onChange={(event) => {
            setName(event.target.value);
            setInvalid(false);
          }}
        />
        {invalid && (
          <p id={`${id}-error`} role="alert" className="text-xs text-bad">
            {t.invalid}
          </p>
        )}
      </div>
      <Button type="submit">{t.submit}</Button>
    </form>
  );
}
