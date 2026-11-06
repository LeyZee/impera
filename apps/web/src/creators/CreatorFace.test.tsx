// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ChipFace, ChipName, CreatorFace } from './CreatorFace';

afterEach(cleanup);

const LEA = CreatorIdSchema.parse('11111111-1111-4111-8111-111111111111');
const MIA = CreatorIdSchema.parse('22222222-2222-4222-8222-222222222222');
const lea = { id: LEA, displayName: 'Léa', hasAvatar: true };

describe('CreatorFace', () => {
  it('shows her photo, served by our own API, where her initial stood', () => {
    const { container } = render(<CreatorFace creator={lea} className="db-top__av" />);
    const face = container.querySelector('.db-top__av');
    expect(face?.className).toContain('cr-face--photo');
    expect(face?.getAttribute('aria-hidden')).toBe('true');
    expect(face?.querySelector('img')?.getAttribute('src')).toBe(`/v1/creators/${LEA}/avatar`);
  });

  it('shows her initial when she has no photo', () => {
    const { container } = render(
      <CreatorFace creator={{ ...lea, hasAvatar: false }} className="db-top__av" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('L');
  });

  it('falls back to her initial when the photo does not load', () => {
    const { container } = render(<CreatorFace creator={lea} className="db-top__av" />);
    const img = container.querySelector('img');
    if (img === null) throw new Error('no photo');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('L');
    expect(container.querySelector('.db-top__av')?.className).not.toContain('cr-face--photo');
  });

  it('tries the photo of another creator again after one failed', () => {
    const { container, rerender } = render(<CreatorFace creator={lea} className="db-top__av" />);
    const img = container.querySelector('img');
    if (img === null) throw new Error('no photo');
    fireEvent.error(img);
    rerender(<CreatorFace creator={{ ...lea, id: MIA, displayName: 'Mia' }} className="db-top__av" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(`/v1/creators/${MIA}/avatar`);
  });
});

describe('ChipFace', () => {
  it('puts her photo before her name, hidden from a screen reader', () => {
    const { container } = render(<ChipFace creator={lea} />);
    const img = container.querySelector('img.cr-chip-face');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('shows her initial in the same disc without a photo, or when it does not load', () => {
    const none = render(<ChipFace creator={{ ...lea, hasAvatar: false }} />);
    expect(none.container.querySelector('img')).toBeNull();
    expect(none.container.querySelector('.cr-chip-face--initial')?.textContent).toBe('L');
    none.unmount();
    const { container } = render(<ChipFace creator={lea} />);
    const img = container.querySelector('img');
    if (img === null) throw new Error('no photo');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cr-chip-face--initial')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ChipName (recette 07/11, EXT-05)', () => {
  it('writes her whole name, and gives it as the title once the chip cuts it', () => {
    const name = 'Anaïs-Morgane de la Recette Très Longue 🌸 نور تجربة Fin';
    const { container } = render(<ChipName name={name} />);
    const span = container.querySelector('.cr-chip-name');
    expect(span?.textContent).toBe(name);
    expect(span?.getAttribute('title')).toBe(name);
  });
});
