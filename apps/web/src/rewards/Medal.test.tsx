// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Medal } from './Medal';

describe('Medal', () => {
  it('names the object for a screen reader, earned or not', () => {
    render(
      <>
        <Medal medal={{ metal: 'or', rank: 3 }} size={40} />
        <Medal medal={{ metal: 'argent', rank: 2 }} earned={false} size={40} />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Médaille d’or' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Médaille d’argent, pas encore gagnée' })).toBeDefined();
  });

  it('wears its laurel from 40 px and stands alone under it', () => {
    const { container } = render(
      <>
        <Medal medal={{ metal: 'bronze', rank: 1 }} size={40} />
        <Medal medal={{ metal: 'bronze', rank: 1 }} size={28} />
      </>,
    );
    const [large, small] = [...container.querySelectorAll('svg')];
    expect(large?.querySelector('.rw-wreath')).not.toBeNull();
    expect(small?.querySelector('.rw-wreath')).toBeNull();
  });

  it('gives every instance its own gradients', () => {
    const { container } = render(
      <>
        <Medal medal={{ metal: 'or', rank: 3 }} size={28} />
        <Medal medal={{ metal: 'or', rank: 3 }} size={28} />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows a halo only when asked, and never on a small medal', () => {
    const { container } = render(
      <>
        <Medal medal={{ metal: 'or', rank: 3 }} size={64} glow />
        <Medal medal={{ metal: 'or', rank: 3 }} size={64} />
        <Medal medal={{ metal: 'or', rank: 3 }} size={28} glow />
      </>,
    );
    expect(container.querySelectorAll('.rw-glow')).toHaveLength(1);
  });

  it('engraves a star from the fourth tier', () => {
    const { container } = render(
      <>
        <Medal medal={{ metal: 'or', rank: 4 }} size={28} />
        <Medal medal={{ metal: 'or', rank: 3 }} size={28} />
      </>,
    );
    const [star, three] = [...container.querySelectorAll('svg')];
    expect(star?.querySelectorAll('.rw-ink rect')).toHaveLength(0);
    expect(three?.querySelectorAll('.rw-ink rect')).toHaveLength(5);
  });
});
