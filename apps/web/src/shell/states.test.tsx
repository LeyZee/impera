// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Empty, Failure, Skeleton, SkeletonCard } from './states';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Empty (COH-04)', () => {
  it('says one sentence in the whisper face, one line under it and one soft button', () => {
    render(
      <Empty
        title="Pas encore de facture."
        action={
          <button type="button" className="nv-btn nv-btn--soft">
            Remplir mon dossier
          </button>
        }
      >
        Elle arrive avec ton premier relevé validé.
      </Empty>,
    );
    expect(screen.getByText('Pas encore de facture.').className).toBe('nv-empty__title');
    expect(screen.getByText('Elle arrive avec ton premier relevé validé.').className).toBe('nv-empty__text');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('writes nothing it is not given', () => {
    const { container } = render(<Empty title="Rien ici." />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('.nv-empty__action')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('.nv-plate')).toBeNull();
  });

  it('stands on a card of its own with `plate`', () => {
    const { container } = render(<Empty title="Rien ici." plate />);
    expect(container.querySelector('.nv-plate .nv-empty')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Rien ici.');
  });
});

describe('Failure (ETA-04)', () => {
  it('says the server is silent, what to do, and offers « Réessayer », as an alert', () => {
    const onRetry = vi.fn();
    render(<Failure onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Le serveur ne répond pas');
    expect(alert.textContent).toContain('Réessaie dans un instant.');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('gives « Réessayer » the full 44 px button, never the small one', () => {
    render(<Failure onRetry={() => undefined} />);
    const retry = screen.getByRole('button', { name: 'Réessayer' });
    expect(retry.className).toContain('nv-btn');
    expect(retry.className).not.toContain('nv-btn--sm');
  });

  it('takes a title, a line and a second action placed before « Réessayer »', () => {
    const open = vi.fn();
    render(
      <Failure
        title="Grok ne répond pas"
        action={{ label: 'Ouvrir Modèles IA', onClick: open }}
        onRetry={() => undefined}
      >
        Ajoute ou vérifie sa clé dans Réglages › Modèles IA.
      </Failure>,
    );
    expect(screen.getByRole('heading').textContent).toBe('Grok ne répond pas');
    expect(screen.getByRole('alert').textContent).toContain('Réglages › Modèles IA');
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Ouvrir Modèles IA', 'Réessayer']);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Modèles IA' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('is the page’s h1 when the screen has no title above it', () => {
    render(<Failure headline onRetry={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Le serveur ne répond pas');
  });

  it('inside a card, keeps to one line with no card nor heading of its own', () => {
    const { container } = render(<Failure inline onRetry={() => undefined} />);
    expect(container.querySelector('.nv-plate')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Le serveur ne répond pas');
  });

  it('says « Pas de réseau » without a network: the server is not the one silent', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<Failure onRetry={() => undefined} />);
    expect(screen.getByRole('heading').textContent).toBe('Pas de réseau');
  });
});

describe('Skeleton (ETA-14, ETA-15)', () => {
  it('says « Chargement… » once, and hides its shapes from a screen reader', () => {
    const { container } = render(
      <Skeleton columns={2}>
        <SkeletonCard />
        <SkeletonCard lines={1} />
      </Skeleton>,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe('Chargement…');
    const shapes = container.querySelector('.nv-skeleton__shapes');
    expect(shapes?.getAttribute('aria-hidden')).toBe('true');
    expect(shapes?.getAttribute('data-columns')).toBe('2');
  });

  it('draws its cards as the screen’s cards: the plate, its padding, a title and lines', () => {
    const { container } = render(<SkeletonCard lines={2} height={136} />);
    const card = container.firstElementChild;
    expect(card?.className).toContain('nv-plate nv-plate--pad');
    expect(card?.querySelectorAll('.nv-skeleton__bar')).toHaveLength(3);
    expect(card?.querySelectorAll('.nv-skeleton__bar--title')).toHaveLength(1);
    expect(card?.getAttribute('style')).toContain('min-height: 136px');
  });

  it('draws one card when it is given no shapes', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelectorAll('.nv-skeleton__card')).toHaveLength(1);
  });
});
