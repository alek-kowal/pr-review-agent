// S-12-T4: the merge checklist card: failing rows first, every row behind "Show all N", all green
// as one line naming the head commit.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { ChecklistView } from '@/lib/api-types.ts';
import { aChecklist, aPrView } from '@/test/fixtures.ts';
import { Checklist } from './Checklist.tsx';

const ciRed: ChecklistView['items'][number] = {
  item: 'ci_green',
  ok: false,
  reason: {
    code: 'checklist_ci_failing',
    params: { failed: 1, total: 3, names: ['e2e'] },
  },
};

describe('the merge checklist', () => {
  const items = aChecklist().items;

  test('only failing rows show by default, every row behind "Show all N"', async () => {
    const checklist = aChecklist({ items: [...items, ciRed] });
    const user = userEvent.setup();
    render(<Checklist repo="wb" number="12" view={aPrView({ checklist })} />);

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('3 findings to decide.');
    expect(list).toHaveTextContent('CI green in GitHub');
    expect(list).toHaveTextContent('1 of 3 checks failing: e2e.');
    expect(list).not.toHaveTextContent('The review covers');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all 3' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list).toHaveTextContent('The review covers abc1234, the head commit.');
  });

  test('all green is one line, "Checklist green at <sha>", that opens the list', async () => {
    const green = { ok: true, items: items.map((i) => ({ ...i, ok: true })) };
    const user = userEvent.setup();
    render(<Checklist repo="wb" number="12" view={aPrView({ checklist: green })} />);

    const line = screen.getByRole('button', { name: /Checklist green at abc123/ });
    expect(line).toHaveTextContent('2 of 2');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    await user.click(line);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
  });
});
