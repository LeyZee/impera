// @vitest-environment jsdom
import { PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { RevealAccounts } from '../../lib/watch/protocol';

import {
  copilotCard,
  syncCard,
  syncWanted,
  whenOf,
  type CopilotActions,
  type CopilotView,
  type SyncActions,
  type SyncView,
} from './reveal-view';

// Invented accounts (ADR 0010).
const ACCOUNT_A = PlatformAccountIdSchema.parse('7c1e2b3a-4d5f-4a6b-8c7d-9e0f1a2b3c4d');
const ACCOUNT_B = PlatformAccountIdSchema.parse('8d2f3c4b-5e6a-4b7c-9d8e-0f1a2b3c4d5e');
const ACCOUNT_C = PlatformAccountIdSchema.parse('9e3a4d5c-6f7b-4c8d-8e9f-1a2b3c4d5e6f');
const NOW = new Date(2026, 10, 15, 22, 0);

const names = (root: HTMLElement | null): readonly string[] =>
  [...(root?.querySelectorAll('button') ?? [])].map((one) => one.textContent.trim());

function sync(
  accounts: RevealAccounts,
  overrides: Partial<SyncView> = {},
): { card: HTMLElement | null; actions: SyncActions } {
  const actions: SyncActions = { sync: vi.fn(), send: vi.fn(), cancel: vi.fn(), retry: vi.fn() };
  const view: SyncView = { accounts, notice: null, pending: null, confirm: null, now: NOW, ...overrides };
  return { card: syncCard(view, actions, 4), actions };
}

const THREE: RevealAccounts = {
  state: 'ok',
  accounts: [
    {
      id: ACCOUNT_A,
      handle: 'atelier.lune',
      creatorName: 'Lune',
      sessionState: 'valid',
      sessionUpdatedAt: new Date(2026, 10, 15, 21, 39).toISOString(),
    },
    {
      id: ACCOUNT_B,
      handle: 'soleil.noir',
      creatorName: 'Soleil',
      sessionState: 'expired',
      sessionUpdatedAt: null,
    },
    {
      id: ACCOUNT_C,
      handle: 'brume.douce',
      creatorName: 'Brume',
      sessionState: 'warning',
      sessionUpdatedAt: null,
    },
  ],
};

function copilot(
  overrides: Partial<CopilotView> = {},
  options: { compact?: boolean; neon?: boolean } = {},
): { card: HTMLElement; actions: CopilotActions; openPanel: () => void } {
  const actions: CopilotActions = { link: vi.fn(), openSecurity: vi.fn() };
  const openPanel = vi.fn();
  const view: CopilotView = { link: 'linked', draft: '', notice: null, busy: false, ...overrides };
  const card = copilotCard(
    view,
    { compact: options.compact ?? false, neon: options.neon ?? true, index: 3 },
    openPanel,
    actions,
  );
  return { card, actions, openPanel };
}

describe('the copilot card on a Reveal tab', () => {
  // Recette du 16/11, EXT-02: a chatter had no « Relier », and his gestures never counted.
  it('offers the link with the code on one line, and the way to Sécurité as a link', () => {
    const { card, actions } = copilot({ link: 'none' });
    expect(card.textContent).toContain('À relier');
    expect(card.textContent).toContain('tes gestes du copilote comptent alors à ton nom');
    const input = card.querySelector<HTMLInputElement>('#extension-link');
    if (input === null) throw new Error('no field');
    expect(card.querySelector('label[for="extension-link"]')?.textContent).toBe('Code de liaison');
    expect(input.parentElement?.classList.contains('pp-inline')).toBe(true);
    expect(names(input.parentElement)).toEqual(['Relier']);
    input.value = 'code';
    card.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(actions.link).toHaveBeenCalledWith('code');
    const go = card.querySelector<HTMLButtonElement>('.pp-link--go');
    expect(go?.textContent).toBe('Ouvrir Sécurité');
    expect(go?.querySelector('svg')).not.toBeNull();
    go?.click();
    expect(actions.openSecurity).toHaveBeenCalledOnce();
  });

  // EXT-11: the copilot is the tab's action, in neon and across.
  it('opens the copilot from its neon, whether linked or not', () => {
    for (const link of ['none', 'linked'] as const) {
      const { card, openPanel } = copilot({ link });
      const open = [...card.querySelectorAll('button')].find(
        (one) => one.textContent === 'Ouvrir le copilote',
      );
      expect(open?.className).toContain('nv-btn--neon');
      expect(open?.className).toContain('pp-wide');
      open?.click();
      expect(openPanel).toHaveBeenCalledOnce();
    }
  });

  it('says a link the CRM removed', () => {
    expect(copilot({ link: 'revoked' }).card.textContent).toContain('retirée dans le CRM');
  });

  it('is one line beside the session card, its button soft while a session waits (EXT-12)', () => {
    const { card } = copilot({ link: 'linked' }, { compact: true, neon: false });
    expect(card.querySelector('.pp-card__body')).toBeNull();
    expect(names(card)).toEqual(['Ouvrir le copilote']);
    expect(card.querySelector('.nv-btn--soft')).not.toBeNull();
  });

  it('keeps the link part while compact, since nothing counts without it', () => {
    expect(copilot({ link: 'none' }, { compact: true }).card.querySelector('form')).not.toBeNull();
  });

  it('says « Envoi… » on « Relier » while the code is on its way', () => {
    const { card } = copilot({ link: 'none', busy: true });
    const relier = card.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(relier?.textContent).toBe('Envoi…');
    expect(relier?.disabled).toBe(true);
  });
});

describe('the Reveal session card', () => {
  it('lists each Reveal account with its session and a button that reads that one', () => {
    const { card, actions } = sync(THREE);
    const text = card?.textContent ?? '';
    expect(card?.querySelector('.pp-card__title')?.textContent).toBe('Session Reveal');
    expect(text).toContain('À synchroniser');
    // EXT-26: the day as the CRM writes it.
    expect(text).toContain('Session valide, envoyée le 15/11/2026 à 21 h 39.');
    expect(text).toContain('Session expirée');
    const buttons = [...(card?.querySelectorAll('button') ?? [])];
    expect(buttons).toHaveLength(3);
    buttons[1]?.click();
    expect(actions.sync).toHaveBeenCalledWith(ACCOUNT_B);
  });

  // V-EXT-05: two late accounts gave two neons.
  it('lights only the first late account', () => {
    const { card } = sync(THREE);
    const neon = [...(card?.querySelectorAll('.nv-btn--neon') ?? [])];
    expect(neon).toHaveLength(1);
    expect(neon[0]?.closest('.pp-sync__account')?.textContent).toContain('Soleil');
  });

  it('keeps the advice while a session is late, and drops it once all are up to date (V-EXT-01)', () => {
    expect(sync(THREE).card?.textContent).toContain('Garde la messagerie Reveal ouverte');
    const fine = sync({ state: 'ok', accounts: THREE.accounts.slice(0, 1) }).card;
    expect(fine?.textContent).not.toContain('Garde la messagerie Reveal ouverte');
    expect(fine?.textContent).toContain('À jour');
  });

  it('is not drawn without the owner’s link: its « Relier » is the copilot’s', () => {
    expect(sync({ state: 'none', accounts: [] }).card).toBeNull();
    expect(sync({ state: 'revoked', accounts: [] }).card).toBeNull();
    expect(sync({ state: 'not-owner', accounts: [] }).card).toBeNull();
  });

  // EXT-19 and V-EXT-16: up to 30 s without a word, every button pale.
  it('says which account is read, and that the tab may reload', () => {
    const { card } = sync(THREE, { pending: { accountId: ACCOUNT_B, phase: 'reading' } });
    expect(names(card)).toEqual(['Synchroniser', 'Lecture…', 'Synchroniser']);
    expect([...(card?.querySelectorAll('button') ?? [])].every((one) => one.disabled)).toBe(true);
    expect(card?.querySelector('.pp-card__body [role="status"]')?.textContent).toContain(
      'l’onglet Reveal peut se recharger',
    );
    expect(sync(THREE, { pending: { accountId: ACCOUNT_B, phase: 'sending' } }).card?.textContent).toContain(
      'Envoi…',
    );
  });

  it('writes the day and the hour', () => {
    expect(whenOf(new Date(2026, 10, 9, 8, 30))).toBe('le 09/11/2026 à 8 h 30');
  });
});

describe('before a session leaves (demande de Sécurité)', () => {
  const confirm = (seen: 'same' | 'other' | 'unknown') =>
    sync(THREE, { confirm: { accountId: ACCOUNT_B, modelId: 'model-essai-7', seen } });

  it('shows the account alone and the model read in the tab, « Annuler » first on a first sync', () => {
    const { card, actions } = confirm('unknown');
    const text = card?.textContent ?? '';
    expect(text).toContain('Première synchro de ce compte');
    expect(text).toContain('Soleil (@soleil.noir)');
    expect(text).not.toContain('Lune');
    expect(text).not.toContain('Garde la messagerie Reveal ouverte');
    expect(card?.querySelector('.pp-code')?.textContent).toBe('model-essai-7');
    expect(names(card)).toEqual(['Annuler', 'Envoyer la session']);
    // The safe choice holds the focus; « Envoyer » is soft, never the neon.
    expect(card?.querySelector('[data-autofocus]')?.textContent).toBe('Annuler');
    expect(card?.querySelector('.nv-btn--neon')).toBeNull();
    [...(card?.querySelectorAll('button') ?? [])][1]?.click();
    expect(actions.send).toHaveBeenCalledOnce();
    [...(card?.querySelectorAll('button') ?? [])][0]?.click();
    expect(actions.cancel).toHaveBeenCalledOnce();
  });

  it('only cancels when the tab shows another model than last time', () => {
    const { card } = confirm('other');
    expect(names(card)).toEqual(['Annuler']);
    expect(card?.querySelector('.pp-hint--amber')?.textContent).toContain('un autre modèle');
  });

  it('puts the focus on « Envoyer » when the model is the one of last time', () => {
    expect(confirm('same').card?.querySelector('[data-autofocus]')?.textContent).toBe('Envoyer la session');
  });
});

describe('syncWanted', () => {
  it('asks for the one neon when a session is missing or ending, never on a card at rest', () => {
    const view = (accounts: RevealAccounts): SyncView => ({
      accounts,
      notice: null,
      pending: null,
      confirm: null,
      now: NOW,
    });
    expect(syncWanted(view(THREE))).toBe(true);
    expect(syncWanted(view({ state: 'none', accounts: [] }))).toBe(false);
    expect(syncWanted(view({ state: 'ok', accounts: THREE.accounts.slice(0, 1) }))).toBe(false);
    expect(syncWanted(view({ state: 'unreachable', accounts: [] }))).toBe(false);
    expect(syncWanted(null)).toBe(false);
  });
});
