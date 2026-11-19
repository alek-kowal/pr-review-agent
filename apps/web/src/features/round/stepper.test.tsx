import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { roundFixture } from '@/test/round-fixtures.ts';
import { Stepper } from './Stepper.tsx';

const renderStepper = (kind: Parameters<typeof roundFixture>[0]) => {
  const view = roundFixture(kind);
  render(
    <Stepper
      steps={view.roundProgress!.steps}
      level={view.latestRound!.level.number}
      runFailed={view.latestRound!.status === 'failed'}
    />,
  );
  const list = screen.getByRole('list', { name: 'Stages of this round' });
  const step = (name: string) =>
    within(list)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.startsWith(name))!;
  return { list, step };
};

describe('Stepper', () => {
  it('running: marks the current stage and shows its cost so far', () => {
    const { step } = renderStepper('running');
    expect(step('Review')).toHaveAttribute('aria-current', 'step');
    expect(step('Review')).toHaveTextContent('working · $0.40');
    expect(step('Task')).toHaveTextContent('$0.02');
    expect(step('Checks')).toHaveTextContent('1 min');
    expect(step('Verify')).toHaveTextContent('off at level 2');
  });

  it('failed: names why the stage failed and what it cost; later stages did not run', () => {
    const { step } = renderStepper('failed');
    expect(step('Review')).toHaveAttribute('data-status', 'failed');
    expect(step('Review')).toHaveTextContent('the stage ran out of time · $1.10');
    expect(step('Verify')).toHaveTextContent('off at level 2');
  });

  it('finished: every run stage is done with its time and cost', () => {
    const { step } = renderStepper('finished');
    expect(step('Review')).toHaveTextContent('7 min · $1.82');
    expect(step('Review')).not.toHaveAttribute('aria-current');
  });

  it('level 1: Checks, Task, Change type and Verify are listed as off', () => {
    const { list, step } = renderStepper('level1');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.dataset.step),
    ).toEqual(['checks', 'task', 'change_type', 'review', 'verify']);
    for (const name of ['Checks', 'Task', 'Change type', 'Verify']) {
      expect(step(name)).toHaveTextContent('off at level 1');
    }
    expect(step('Review')).toHaveAttribute('data-status', 'running');
  });
});
