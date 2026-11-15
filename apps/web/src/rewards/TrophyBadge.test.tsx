// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TROPHY_NAMES, TrophyBadge, type TrophyKind } from './TrophyBadge';

const KINDS = Object.keys(TROPHY_NAMES).filter((kind): kind is TrophyKind => kind in TROPHY_NAMES);

describe('TrophyBadge', () => {
  it('names every trophy of the closed list, earned or not', () => {
    render(
      <>
        {KINDS.map((kind) => (
          <TrophyBadge key={kind} kind={kind} size={64} />
        ))}
        <TrophyBadge kind="streak_10" earned={false} size={64} />
      </>,
    );
    for (const kind of KINDS)
      expect(screen.getByRole('img', { name: `Trophée « ${TROPHY_NAMES[kind]} »` })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Trophée « Série de 10 », pas encore gagné' })).toBeDefined();
  });

  it('writes a streak’s count in plain digits, and drops it under 40 px', () => {
    const { container } = render(
      <>
        <TrophyBadge kind="streak_25" size={64} />
        <TrophyBadge kind="streak_25" size={28} />
      </>,
    );
    const [large, small] = [...container.querySelectorAll('svg')];
    expect(large?.querySelector('text')?.textContent).toBe('25');
    expect(small?.querySelector('text')).toBeNull();
  });

  it('keeps a trophy not yet earned a plain shield under 40 px', () => {
    const { container } = render(<TrophyBadge kind="first_sale" earned={false} size={24} />);
    expect(container.querySelector('.rw-symbol')).toBeNull();
  });

  it('gives every instance its own gradients, and a halo only when asked on a large badge', () => {
    const { container } = render(
      <>
        <TrophyBadge kind="day_record" size={96} glow />
        <TrophyBadge kind="day_record" size={96} />
        <TrophyBadge kind="day_record" size={28} glow />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelectorAll('.rw-glow')).toHaveLength(1);
  });
});
