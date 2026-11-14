// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CREATOR_HOW_TO,
  CREATOR_MEDALS,
  CREATOR_TROPHY_NAMES,
  CreatorObject,
  creatorObjectName,
  creatorRevealWordsOf,
  highestMedal,
} from './creator-art';

afterEach(cleanup);

const KINDS = [...Object.keys(CREATOR_MEDALS), ...Object.keys(CREATOR_TROPHY_NAMES)];

describe('her objects (ADR 0107 § 1, § 3 and § 16)', () => {
  it('draws every medal and trophy of hers, earned or not, large and small, named for a screen reader', () => {
    for (const kind of KINDS)
      for (const size of [24, 40, 96])
        for (const earned of [true, false]) {
          const { unmount } = render(<CreatorObject kind={kind} size={size} earned={earned} />);
          const name = creatorObjectName(kind) ?? '';
          expect(screen.getByRole('img').getAttribute('aria-label')).toContain(name);
          unmount();
        }
  });

  it('engraves her days on the medal, and one star at 50, two at 100', () => {
    render(<CreatorObject kind="day_streak_100" size={96} />);
    const svg = screen.getByRole('img', { name: 'Médaille « Série de 100 jours »' });
    expect(svg.querySelector('.rw-ink text')?.textContent).toBe('100');
    expect(svg.querySelectorAll('.rw-ink path')).toHaveLength(2);
    expect(svg.getAttribute('data-metal')).toBe('or');
  });

  it('shows the metal alone under 40 px, so no number on the coin reads against her streak', () => {
    render(<CreatorObject kind="day_streak_14" size={28} />);
    const svg = screen.getByRole('img', { name: 'Médaille « Série de 14 jours »' });
    expect(svg.querySelector('.rw-ink text')?.textContent).toBe('');
    expect(svg.getAttribute('data-metal')).toBe('argent');
  });

  it('has a name, a way to earn it and a reveal for each, and nothing for a kind it does not know', () => {
    for (const kind of KINDS) {
      expect(creatorObjectName(kind)).not.toBeNull();
      expect(kind in CREATOR_HOW_TO).toBe(true);
      expect(creatorRevealWordsOf({ kind })?.title).toBe(creatorObjectName(kind));
    }
    expect(creatorObjectName('first_sale')).toBeNull();
    expect(creatorRevealWordsOf({ kind: 'first_sale' })).toBeNull();
  });

  it('puts her highest medal earned beside her streak, none before the first', () => {
    const earned = (kind: string) => ({ kind, earnedAt: '2026-11-10T08:00:00Z' });
    const ahead = (kind: string) => ({ kind, earnedAt: null });
    expect(highestMedal([earned('day_streak_7'), earned('day_streak_14'), ahead('day_streak_30')])).toBe(
      'day_streak_14',
    );
    expect(highestMedal([ahead('day_streak_7'), earned('first_drop')])).toBeNull();
  });
});
