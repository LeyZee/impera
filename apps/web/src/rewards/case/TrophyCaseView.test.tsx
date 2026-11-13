// @vitest-environment jsdom
import type { TrophyCase, TrophyCaseItem } from '@impera/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrophyCaseView, type TrophyCaseEntry } from './TrophyCaseView';

// Reduced motion: the percentage is its final figure at once, the reveal its still picture.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NAMES: Readonly<Record<string, string>> = {
  tier_3: 'Palier Or',
  streak_5: 'Série de 5',
  streak_10: 'Série de 10',
  first_sale: 'Première vente',
  day_record: 'Record du jour',
};

const entry = (item: TrophyCaseItem): TrophyCaseEntry | null => {
  const name = NAMES[item.kind];
  if (name === undefined) return null;
  return {
    name,
    how: `Comment gagner ${name}`,
    ...(item.progress ? { left: `Encore ${String(item.progress.target - item.progress.current)}` } : {}),
    art: (size, earned) => (
      <svg role="img" aria-label={`${name}${earned ? '' : ', pas encore'}`} width={size} />
    ),
    reveal: { kicker: 'Trophée gagné', text: `Tu as gagné ${name}.`, tone: 'neon' },
  };
};

const CASE: TrophyCase = {
  items: [
    {
      kind: 'first_sale',
      family: 'trophy',
      earnedAt: '2026-10-02T10:00:00.000Z',
      revealedAt: '2026-10-02T10:00:00.000Z',
      progress: null,
    },
    {
      kind: 'day_record',
      family: 'trophy',
      earnedAt: '2026-11-04T10:00:00.000Z',
      revealedAt: null,
      progress: null,
    },
    {
      kind: 'streak_5',
      family: 'streak',
      earnedAt: '2026-10-28T10:00:00.000Z',
      revealedAt: '2026-10-28T10:00:00.000Z',
      progress: null,
    },
    {
      kind: 'streak_10',
      family: 'streak',
      earnedAt: null,
      revealedAt: null,
      progress: { current: 9, target: 10, unit: 'shift' },
    },
    {
      kind: 'tier_3',
      family: 'medal',
      earnedAt: null,
      revealedAt: null,
      progress: { current: 38, target: 100, unit: 'cents' },
    },
    { kind: 'unknown_yet', family: 'trophy', earnedAt: null, revealedAt: null, progress: null },
  ],
  streaks: [{ kind: 'shift', current: 9, best: 14 }],
  level: null,
};

const renderCase = (props: Partial<Parameters<typeof TrophyCaseView>[0]> = {}) =>
  render(
    <TrophyCaseView
      trophyCase={CASE}
      entry={entry}
      chips={[
        { label: 'Série en cours', value: '9 shifts' },
        { label: 'Meilleure série', value: '14 shifts' },
      ]}
      sound={false}
      {...props}
    />,
  );

describe('TrophyCaseView', () => {
  it('puts the most advanced object on top, with its figures', () => {
    renderCase();
    const hero = screen.getByRole('region', { name: 'Série de 10' });
    expect(within(hero).getByText('Prochain trophée')).toBeDefined();
    expect(within(hero).getByText('90')).toBeDefined();
    expect(within(hero).getByText('Encore 1')).toBeDefined();
    expect(hero.textContent).toContain('3 sur 5 gagnés');
    expect(hero.textContent).toContain('Meilleure série : 14 shifts');
  });

  it('lays the shelves out in their order and leaves out what the screen does not know', () => {
    renderCase();
    expect(screen.getAllByRole('heading', { level: 3 }).map((one) => one.textContent)).toEqual([
      'Médailles',
      'Séries',
      'Trophées',
    ]);
    const trophies = screen.getByRole('region', { name: 'Trophées' });
    expect(within(trophies).getByText('2 sur 2')).toBeDefined();
  });

  it('shows how far along in a meter, never a percentage for an object earned at once', () => {
    renderCase();
    expect(screen.getByRole('meter', { name: 'Palier Or, 38 %' })).toBeDefined();
    expect(screen.queryByRole('meter', { name: /Première vente/ })).toBeNull();
  });

  it('plays an owed reveal when its object is opened, and hands it back once closed', () => {
    const onRevealed = vi.fn();
    renderCase({ onRevealed });
    expect(screen.getByText('Nouveau')).toBeDefined();
    fireEvent.click(screen.getByText('Record du jour'));
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(onRevealed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'day_record' }));
  });

  it('opens an earned object with « Revoir », and keeps the agency to reading', () => {
    renderCase();
    fireEvent.click(screen.getByText('Première vente'));
    expect(screen.getByRole('button', { name: 'Revoir' })).toBeDefined();
    cleanup();
    renderCase({ readOnly: true });
    fireEvent.click(screen.getByText('Record du jour'));
    expect(screen.queryByRole('button', { name: 'Revoir' })).toBeNull();
    expect(screen.getByText(/Comment gagner Record du jour/)).toBeDefined();
  });

  it('writes the role’s note under an object earned more than once', () => {
    render(
      <TrophyCaseView
        trophyCase={CASE}
        entry={(item) => {
          const one = entry(item);
          return one && item.kind === 'streak_5'
            ? { ...one, earnedNote: '3 fois · dernière le 9 nov.' }
            : one;
        }}
        chips={[]}
        sound={false}
      />,
    );
    expect(screen.getByText('3 fois · dernière le 9 nov.')).toBeDefined();
  });
});
