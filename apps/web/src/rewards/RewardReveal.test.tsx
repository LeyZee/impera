// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LevelInsignia } from './LevelInsignia';
import { RewardReveal } from './RewardReveal';
import { TrophyBadge } from './TrophyBadge';

afterEach(cleanup);

/** An audio context that accepts every call and plays nothing: what the sound asks of it is not what is tested. */
function fakeAudio(): unknown {
  const anything: ProxyHandler<() => unknown> = {
    get: (_target, key) => {
      if (key === 'currentTime') return 0;
      if (key === 'sampleRate') return 8000;
      if (key === 'close') return () => Promise.resolve();
      if (key === 'getChannelData') return () => new Float32Array(16);
      return node;
    },
    apply: () => node,
  };
  const node: unknown = new Proxy(() => undefined, anything);
  return node;
}

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

  it('keeps the keyboard on « Continuer »: Tab never reaches the page behind, Échap closes from anywhere', () => {
    const behind = document.createElement('button');
    document.body.append(behind);
    const onClose = vi.fn();
    reveal(onClose);
    behind.focus();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continuer' }));
    behind.focus();
    fireEvent.keyDown(behind, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    behind.remove();
  });

  it('stays silent when the account’s sounds are off', () => {
    const created = vi.fn();
    vi.stubGlobal('AudioContext', created);
    reveal(() => undefined);
    expect(created).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('forges a rank: the cold medallion under the lit one, embers and a flash, all hidden from assistive tech', () => {
    render(
      <RewardReveal
        object={<LevelInsignia rank={4} size={220} glow />}
        kicker="Nouveau rang"
        title="Séducteur"
        text="Ton net depuis ton arrivée vient de passer 5 000 €."
        tone="neon"
        forge={4}
        sound={false}
        onClose={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Séducteur' });
    expect(dialog.dataset['forge']).toBe('true');
    expect(document.querySelectorAll('.rw-forge__ember')).toHaveLength(18);
    const cold = document.querySelector('.rw-forge__cold');
    expect(cold?.getAttribute('aria-hidden')).toBe('true');
    expect(cold?.querySelector('[data-earned="false"]')).not.toBeNull();
    expect(document.querySelector('.rw-forge__flash')).not.toBeNull();
    // The one insignia a screen reader meets is the lit one.
    expect(screen.getAllByRole('img').map((art) => art.getAttribute('aria-label'))).toEqual([
      'Insigne du rang « Séducteur »',
    ]);
  });

  it('turns any other object over, without a forge', () => {
    reveal(() => undefined);
    expect(screen.getByRole('dialog').dataset['forge']).toBe('false');
    expect(document.querySelector('.rw-forge__cold')).toBeNull();
    expect(document.querySelector('.rw-forge__ember')).toBeNull();
  });

  it('plays the forge’s own sound for a rank when sounds are on', () => {
    const created = vi.fn(function (this: unknown) {
      return fakeAudio();
    });
    vi.stubGlobal('AudioContext', created);
    render(
      <RewardReveal
        object={<LevelInsignia rank={1} size={220} />}
        kicker="Nouveau rang"
        title="Étincelle"
        text="Ton premier rang."
        tone="neon"
        forge={1}
        sound
        onClose={() => undefined}
      />,
    );
    expect(created).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
