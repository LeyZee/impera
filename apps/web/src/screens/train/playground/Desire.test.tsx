// @vitest-environment jsdom
import type { DesireMarkVerdict, PlaygroundDesire } from '@impera/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  availabilityReason,
  DesireGauge,
  DesireTag,
  desireVerdict,
  pointsLabel,
  signalLines,
} from './Desire';

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

  it('lets the owner mark the score, says his mark folded, and asks nothing when it cannot be kept', () => {
    const marked: DesireMarkVerdict[] = [];
    const { rerender } = render(
      <DesireTag
        desire={DESIRE}
        onMark={(verdict) => {
          marked.push(verdict);
        }}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Cette note te semble' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Désir/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Trop haute' }));
    expect(marked).toEqual(['too_high']);

    rerender(
      <DesireTag
        desire={{ ...DESIRE, mark: 'too_high' }}
        onMark={(verdict) => {
          marked.push(verdict);
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Désir/ }).textContent).toContain('notée trop haute');
    expect(screen.getByRole('button', { name: 'Trop haute' }).getAttribute('aria-pressed')).toBe('true');
    // The same word again is no new mark.
    fireEvent.click(screen.getByRole('button', { name: 'Trop haute' }));
    expect(marked).toEqual(['too_high']);

    rerender(<DesireTag desire={DESIRE} />);
    expect(screen.queryByRole('group', { name: 'Cette note te semble' })).toBeNull();
  });

  it('reads the score against her own thresholds', () => {
    const thresholds = { open: 30, script: 60 };
    expect(desireVerdict(20, thresholds)).toBe('Elle n’ouvre pas l’intime elle-même');
    expect(desireVerdict(30, thresholds)).toBe('Elle peut ouvrir l’intime, pas encore de script');
    expect(desireVerdict(60, thresholds)).toBe('Assez chaud pour un script');
  });

  it('says his availability beside the score, what set it, and which condition of the gate is missing (ADR 0103 § 14)', () => {
    const availability: NonNullable<PlaygroundDesire['availability']> = {
      state: 'unknown',
      signal: 'alone',
      seen: ['alone', 'at_home'],
      expiresAt: new Date('2026-11-15T22:00:00Z'),
      sexualized: true,
      asked: true,
      gate: {
        open: false,
        missing: [{ code: 'availability_unconfirmed', label: 'Il n’a pas dit être seul et libre' }],
      },
    };
    render(<DesireTag desire={{ ...DESIRE, availability }} />);
    expect(screen.getByRole('button').textContent).toBe('Désir 40−30· Disponible : inconnue');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('il est seul, il est chez lui')).toBeTruthy();
    expect(screen.getByText('Elle a demandé s’il est tranquille')).toBeTruthy();
    // « oui » for his sexualizing and for her question: one word for both.
    expect(screen.getAllByText('oui', { selector: '.pg-availability__value' })).toHaveLength(2);
    expect(screen.getByText('fermée')).toBeTruthy();
    expect(screen.getByText('Il n’a pas dit être seul et libre')).toBeTruthy();

    expect(availabilityReason({ ...availability, state: 'no', signal: 'leaving_soon', seen: [] })).toBe(
      'il doit partir',
    );
    expect(availabilityReason({ ...availability, seen: [] })).toBeNull();
    // A sign that weighs nothing is said in « Disponible », not as a +0 among the points.
    expect(signalLines({ ...DESIRE, signals: [{ signal: 'free_now', points: 0 }] })).toEqual([]);
  });

  it('shows his availability in « Pourquoi » under the gauge, and nothing without it', () => {
    const { rerender } = render(<DesireGauge desire={DESIRE} thresholds={{ open: 40, script: 70 }} />);
    expect(screen.queryByText(/Disponible/)).toBeNull();
    rerender(
      <DesireGauge
        desire={{
          ...DESIRE,
          availability: {
            state: 'confirmed',
            signal: 'free_now',
            seen: ['alone', 'free_now'],
            expiresAt: null,
            sexualized: false,
            asked: false,
            gate: {
              open: false,
              missing: [{ code: 'not_sexualizing', label: 'Il ne sexualise pas encore lui-même' }],
            },
          },
        }}
        thresholds={{ open: 40, script: 70 }}
      />,
    );
    expect(screen.getByText('confirmée')).toBeTruthy();
    expect(screen.getByText('pas encore')).toBeTruthy();
    expect(screen.queryByText('Elle a demandé s’il est tranquille')).toBeNull();
  });
});
