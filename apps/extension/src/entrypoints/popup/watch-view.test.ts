// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { WatchStatus } from '../../lib/watch/protocol';

import { hourOf, minutesSince, watchCard, type WatchActions, type WatchView } from './watch-view';

const CREATOR_A = CreatorIdSchema.parse('0d4c7f5e-3b1a-4c8e-9a2d-6e5f4b3a2c10');
const CREATOR_B = CreatorIdSchema.parse('1e5d8a6f-4c2b-4d9f-8b3e-7f6a5c4b3d21');
const NOW = new Date(2026, 10, 6, 14, 12);

const READY: WatchStatus = { allowed: true, link: 'linked', watch: null, vision: null, lastCreatorId: null };
const WATCHING: WatchStatus = {
  ...READY,
  watch: {
    startedAt: new Date(2026, 10, 6, 14, 0).toISOString(),
    endsAt: new Date(2026, 10, 6, 14, 45).toISOString(),
    posts: 34,
    marked: 1,
    amber: false,
  },
  lastCreatorId: CREATOR_B,
};

function draw(
  status: WatchStatus,
  overrides: Partial<WatchView> = {},
): { card: HTMLElement; actions: WatchActions } {
  const actions: WatchActions = {
    link: vi.fn(),
    allow: vi.fn(),
    begin: vi.fn(),
    end: vi.fn(),
    mark: vi.fn(),
    openSecurity: vi.fn(),
  };
  const view: WatchView = {
    status,
    creators: [
      { id: CREATOR_A, displayName: 'Créatrice A' },
      { id: CREATOR_B, displayName: 'Créatrice B' },
    ],
    notice: null,
    busy: false,
    now: NOW,
    draft: '',
    ...overrides,
  };
  return { card: watchCard(view, actions), actions };
}

const buttonNamed = (root: HTMLElement, name: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
  if (found === undefined) throw new Error(`no button « ${name} »`);
  return found;
};

describe('the watch card', () => {
  it('asks for the code first, and hands it over as typed', () => {
    const { card, actions } = draw({ ...READY, link: 'none' });
    expect(card.querySelector('.nv-status')?.textContent).toBe('À relier');
    const input = card.querySelector<HTMLInputElement>('#watch-link');
    if (input === null) throw new Error('no field');
    expect(card.querySelector('label[for="watch-link"]')?.textContent).toBe('Code de liaison');
    input.value = 'un-code-collé';
    card.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(actions.link).toHaveBeenCalledWith('un-code-collé');
    buttonNamed(card, 'Ouvrir Sécurité').click();
    expect(actions.openSecurity).toHaveBeenCalledOnce();
  });

  it('says in amber that a link was removed in the CRM', () => {
    const { card } = draw({ ...READY, link: 'revoked' });
    expect(card.querySelector('.pp-hint--amber')?.textContent).toContain('retirée dans le CRM');
  });

  it('asks the browser for instagram.com, and nothing is read before', () => {
    const { card, actions } = draw({ ...READY, allowed: false });
    expect(card.textContent).toContain('et seulement ce site');
    buttonNamed(card, 'Autoriser et lancer').click();
    expect(actions.allow).toHaveBeenCalledOnce();
  });

  it('starts the watch, saying what it never does', () => {
    const { card, actions } = draw(READY);
    expect(card.textContent).toContain('Jamais un message, jamais un clic à ta place');
    expect(card.textContent).toContain('45 minutes');
    buttonNamed(card, 'Lancer la veille').click();
    expect(actions.begin).toHaveBeenCalledOnce();
  });

  it('shows the watch running, and marks the post on screen for a creator', () => {
    const { card, actions } = draw(WATCHING);
    expect(card.querySelector('.nv-status')?.textContent).toBe('Relève');
    expect(card.querySelector('.pp-watch__time')?.textContent).toBe(
      'Depuis 12\u00a0min · s’arrête à 14\u00a0h\u00a045',
    );
    expect(card.querySelector('.pp-watch__figures')?.textContent).toBe('34\u00a0posts relevés·1\u00a0marqué');
    const chips = [...card.querySelectorAll<HTMLButtonElement>('.nv-chip')];
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    chips[0]?.click();
    expect(actions.mark).toHaveBeenCalledWith(CREATOR_A);
    buttonNamed(card, 'Arrêter').click();
    expect(actions.end).toHaveBeenCalledOnce();
  });

  it('turns amber when the page gives nothing, never red', () => {
    const { card } = draw({
      ...WATCHING,
      watch: WATCHING.watch === null ? null : { ...WATCHING.watch, amber: true },
    });
    expect(card.querySelector('.nv-status')?.textContent).toBe('À regarder');
    expect(card.querySelector('.pp-hint--amber')?.textContent).toContain('Rien n’est rechargé');
    expect(card.querySelector('.nv-status--error')).toBeNull();
  });

  it('says the vision’s cap of the day in amber', () => {
    const { card } = draw({ ...WATCHING, vision: 'budget' });
    expect(card.querySelector('.pp-hint--amber')?.textContent).toContain('jusqu’à minuit');
  });

  it('waits while a gesture is on its way', () => {
    const { card } = draw(WATCHING, { busy: true });
    expect([...card.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });

  it('writes the time the CRM’s way', () => {
    expect(hourOf(new Date(2026, 10, 6, 9, 5))).toBe('9\u00a0h\u00a005');
    expect(minutesSince(NOW, NOW)).toBe('1\u00a0min');
  });
});
