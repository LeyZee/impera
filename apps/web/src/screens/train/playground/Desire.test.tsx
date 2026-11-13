// @vitest-environment jsdom
import type { PlaygroundDesire } from '@impera/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesireTag, desireVerdict, pointsLabel } from './Desire';

const DESIRE: PlaygroundDesire = {
  before: 70,
  score: 40,
  band: 'playful',
  signals: [{ signal: 'busy_now', points: -30 }],
  weightsVersion: 'desire-1',
};

describe('desire in the playground', () => {
  afterEach(cleanup);

  it('folds the score under his message to one line, and opens to what moved it', () => {
    render(<DesireTag desire={DESIRE} />);
    expect(screen.getByRole('button').textContent).toBe('Désir 40−30');
    expect(screen.queryByText('il est occupé')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('il est occupé')).toBeTruthy();
    expect(screen.getAllByText('−30')).toHaveLength(2);
  });

  it('says a first score in a word', () => {
    render(<DesireTag desire={{ ...DESIRE, before: null, score: 0, signals: [] }} />);
    expect(screen.getByRole('button').textContent).toBe('Désir 0première note');
  });

  it('says when nothing moved, and gives no points to a reset', () => {
    render(<DesireTag desire={{ ...DESIRE, before: 40, signals: [] }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Rien n’a bougé sur ce message.')).toBeTruthy();
    expect(pointsLabel(null)).toBe('');
  });

  it('reads the score against her own thresholds', () => {
    const thresholds = { open: 30, script: 60 };
    expect(desireVerdict(20, thresholds)).toBe('Elle n’ouvre pas l’intime elle-même');
    expect(desireVerdict(30, thresholds)).toBe('Elle peut ouvrir l’intime, pas encore de script');
    expect(desireVerdict(60, thresholds)).toBe('Assez chaud pour un script');
  });
});
