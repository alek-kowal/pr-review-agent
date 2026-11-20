import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { TeamMember } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderInRouter } from '@/test/renderInRouter.tsx';
import { LAST_SIGNER_KEY } from './last-signer.ts';
import { SignatureField } from './SignatureField.tsx';
import { useSignature } from './use-signature.ts';

const kasia: TeamMember = {
  id: 'm-kasia',
  name: 'Kasia',
  githubLogin: 'kasia',
  clickupUserId: null,
};
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: '7',
};

/** A signed form as a feature would write it: submit sends `signedBy`, then remembers it. */
function SignedForm({ onSubmit }: { onSubmit: (signedBy: string) => void }) {
  const signature = useSignature();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!signature.signedBy) return setError(copy.signature.required);
        onSubmit(signature.signedBy);
        signature.remember();
      }}
    >
      <SignatureField signature={signature} error={error} />
      <button type="submit">Save</button>
    </form>
  );
}

function renderForm() {
  const onSubmit = vi.fn();
  renderInRouter(<SignedForm onSubmit={onSubmit} />);
  return { onSubmit };
}

const field = () => screen.findByRole('combobox', { name: copy.signature.label });

beforeEach(() => {
  window.localStorage.clear();
  stubFetch({ '/api/team': { members: [kasia, tomek] } });
});
afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('SignatureField', () => {
  test('prefills the last signer from storage', async () => {
    window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id);
    const { onSubmit } = renderForm();

    await waitFor(async () => expect(await field()).toHaveTextContent('Tomek'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith(tomek.id);
  });

  test('ignores a last signer who is no longer in Team', async () => {
    window.localStorage.setItem(LAST_SIGNER_KEY, 'm-removed');
    const { onSubmit } = renderForm();

    await waitFor(async () => expect(await field()).toHaveTextContent(copy.signature.placeholder));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.signature.required);
    expect(await field()).toHaveAttribute('aria-invalid', 'true');
  });

  test('updates storage with the chosen member on submit', async () => {
    window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id);
    const { onSubmit } = renderForm();

    await userEvent.click(await field());
    await userEvent.click(await screen.findByRole('option', { name: /Kasia/ }));
    expect(window.localStorage.getItem(LAST_SIGNER_KEY)).toBe(tomek.id);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith(kasia.id);
    expect(window.localStorage.getItem(LAST_SIGNER_KEY)).toBe(kasia.id);
  });

  test('works by keyboard alone', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await waitFor(async () => expect(await field()).toBeEnabled());

    await user.tab();
    expect(await field()).toHaveFocus();
    await user.keyboard('{Enter}');
    const search = await screen.findByRole('combobox', { name: copy.signature.search });
    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard('tom');
    await user.keyboard('{Enter}');

    await waitFor(async () => expect(await field()).toHaveTextContent('Tomek'));
    await waitFor(async () => expect(await field()).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith(tomek.id);
  });

  test('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { onSubmit } = renderForm();

    await userEvent.click(await field());
    await userEvent.click(await screen.findByRole('option', { name: /Kasia/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith(kasia.id);
    expect(await field()).toHaveTextContent('Kasia');
  });

  test('with an empty Team it links to Settings → Team', async () => {
    stubFetch({ '/api/team': { members: [] } });
    renderForm();

    const link = await screen.findByRole('link', { name: copy.signature.addYourself });
    expect(link).toHaveAttribute('href', '/settings/team');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('with an empty Team a submit shows why nothing happened', async () => {
    stubFetch({ '/api/team': { members: [] } });
    const { onSubmit } = renderForm();
    await screen.findByRole('link', { name: copy.signature.addYourself });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.signature.required);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
