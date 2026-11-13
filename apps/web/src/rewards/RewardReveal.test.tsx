// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RewardReveal } from './RewardReveal';
import { TrophyBadge } from './TrophyBadge';

afterEach(cleanup);

const reveal = (onClose: () => void, chip?: string) =>
  render(
    <RewardReveal
      object={<TrophyBadge kind="first_sale" size={248} glow />}
      kicker="Trophée gagné"
      title="Première vente"
      text="Ta toute première vente est relevée."
      {...(chip === undefined ? {} : { chip })}
      tone="neon"
      sound={false}
      onClose={onClose}
    />,
  );

describe('RewardReveal', () => {
  it('says everything in words: what was earned, its name and why', () => {
    reveal(() => undefined, 'Prime prévue : 60,00 €');
    const dialog = screen.getByRole('dialog', { name: 'Première vente' });
    expect(dialog.textContent).toContain('Trophée gagné');
    expect(dialog.textContent).toContain('Ta toute première vente est relevée.');
    expect(dialog.textContent).toContain('Prime prévue : 60,00 €');
  });

  it('shows no chip when its caller gives none', () => {
    reveal(() => undefined);
    expect(document.querySelector('.rw-reveal__chip')).toBeNull();
  });

  it('closes by « Continuer », by Échap and by a tap anywhere, from its first frame', () => {
    const onClose = vi.fn();
    reveal(onClose);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continuer' }));
  });

  it('stays silent when the account’s sounds are off', () => {
    const created = vi.fn();
    vi.stubGlobal('AudioContext', created);
    reveal(() => undefined);
    expect(created).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
