// @vitest-environment jsdom
import { PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { RevealAccounts } from '../../lib/watch/protocol';

import {
  copilotCard,
  failureOf,
  syncCard,
  syncWanted,
  untilOf,
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
  const view: SyncView = {
    accounts,
    outcome: null,
    pending: null,
    confirm: null,
    now: NOW,
    crm: '127.0.0.1:5173',
    ...overrides,
  };
  return { card: syncCard(view, actions, 4), actions };
}

type Account = RevealAccounts['accounts'][number];
const LUNE: Account = {
  id: ACCOUNT_A,
  handle: 'atelier.lune',
  creatorName: 'Lune',
  sessionState: 'valid',
  sessionUpdatedAt: new Date(2026, 10, 15, 21, 39).toISOString(),
  sessionExpiresAt: null,
};
const SOLEIL: Account = {
  id: ACCOUNT_B,
  handle: 'soleil.noir',
  creatorName: 'Soleil',
  sessionState: 'expired',
  sessionUpdatedAt: null,
  sessionExpiresAt: null,
};
const BRUME: Account = {
  id: ACCOUNT_C,
  handle: 'brume.douce',
  creatorName: 'Brume',
  sessionState: 'warning',
  sessionUpdatedAt: null,
  sessionExpiresAt: new Date(2026, 10, 15, 23, 30).toISOString(),
};
const THREE: RevealAccounts = { state: 'ok', accounts: [LUNE, SOLEIL, BRUME] };

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

const row = (card: HTMLElement | null, name: string): HTMLElement | null =>
  [...(card?.querySelectorAll<HTMLElement>('.pp-sync__account') ?? [])].find((one) =>
    one.textContent.includes(name),
  ) ?? null;

describe('the Reveal session card', () => {
  // Demande de Charles du 19/11: a clear state, no pile of messages.
  it('gives each account one state in a word, the cut one in red, and nothing in the head', () => {
    const { card } = sync(THREE);
    expect(card?.querySelector('.pp-card__title')?.textContent).toBe('Session Reveal');
    expect(card?.querySelector('.pp-card__head .pp-pill')).toBeNull();
    expect(row(card, 'Lune')?.querySelector('.pp-sync__word')?.textContent).toBe('Connectée');
    expect(row(card, 'Soleil')?.querySelector('.pp-sync__word')?.textContent).toBe('Coupée');
    expect(row(card, 'Soleil')?.querySelector('.pp-sync__word--red')).not.toBeNull();
    expect(row(card, 'Brume')?.querySelector('.pp-sync__word')?.textContent).toBe('Expire bientôt');
    expect(card?.textContent).not.toContain('Garde la messagerie Reveal ouverte');
  });

  it('says « Jamais branchée » neutral, the neon alone calling', () => {
    const never = sync({
      state: 'ok',
      accounts: [{ ...SOLEIL, sessionState: 'none' }],
    }).card;
    expect(never?.querySelector('.pp-sync__word--neutral')?.textContent).toBe('Jamais branchée');
    expect(never?.querySelector('.pp-sync__advice')).toBeNull();
    expect(never?.querySelector('.nv-btn--neon')?.textContent).toBe('Synchroniser');
  });

  // Avis Design du 19/11: the same sentence under every account was the pile of messages.
  it('says the gesture late sessions ask for once, under the list', () => {
    const { card } = sync(THREE);
    expect(card?.querySelectorAll('.pp-sync__advice')).toHaveLength(1);
    expect(card?.querySelector('.pp-sync__advice--all')?.textContent).toBe(
      'Reconnecte-toi à Reveal, puis resynchronise.',
    );
    expect(sync({ state: 'ok', accounts: [LUNE] }).card?.querySelector('.pp-sync__advice')).toBeNull();
  });

  it('says the hour a session holds until with a thin gauge, and no line at all once cut', () => {
    const { card } = sync(THREE);
    expect(row(card, 'Brume')?.querySelector('.pp-sync__until')?.textContent).toBe('jusqu’à 23 h 30');
    expect(row(card, 'Brume')?.querySelector<HTMLElement>('.pp-sync__gauge')?.getAttribute('style')).toBe(
      '--nv-gauge-value: 6%',
    );
    expect(row(card, 'Soleil')?.querySelector('.pp-sync__gauge')).toBeNull();
    // No end known: no gauge rather than a made-up one.
    expect(row(card, 'Lune')?.querySelector('.pp-sync__gauge')).toBeNull();
  });

  it('reads the button of each account, the late ones as a button and the fine one as a word', () => {
    const { card, actions } = sync(THREE);
    expect(names(card)).toEqual(['Resynchroniser', 'Synchroniser', 'Synchroniser']);
    expect(row(card, 'Lune')?.querySelector('.pp-sync__again')).not.toBeNull();
    row(card, 'Soleil')?.querySelector('button')?.click();
    expect(actions.sync).toHaveBeenCalledWith(ACCOUNT_B);
    row(card, 'Lune')?.querySelector('button')?.click();
    expect(actions.sync).toHaveBeenCalledWith(ACCOUNT_A);
  });

  // V-EXT-05: two late accounts gave two neons.
  it('lights only the first late account', () => {
    const { card } = sync(THREE);
    const neon = [...(card?.querySelectorAll('.nv-btn--neon') ?? [])];
    expect(neon).toHaveLength(1);
    expect(neon[0]?.closest('.pp-sync__account')?.textContent).toContain('Soleil');
  });

  it('keeps « Resynchroniser » once every session is fine, with no neon', () => {
    const fine = sync({ state: 'ok', accounts: [LUNE] }).card;
    expect(names(fine)).toEqual(['Resynchroniser']);
    expect(fine?.querySelector('.nv-btn--neon')).toBeNull();
  });

  it('gives the day of the last sync in a tip that opens on focus too', () => {
    const { card } = sync(THREE);
    const state = row(card, 'Lune')?.querySelector<HTMLElement>('.pp-sync__state');
    expect(state?.getAttribute('tabindex')).toBe('0');
    state?.dispatchEvent(new FocusEvent('focus'));
    const tip = document.querySelector('.nv-tip');
    expect(tip?.getAttribute('role')).toBe('tooltip');
    expect(tip?.textContent).toContain('15/11 à 21 h 39');
    expect(tip?.textContent).not.toContain('2026');
    expect(state?.getAttribute('aria-describedby')).toBe(tip?.id);
    state?.dispatchEvent(new FocusEvent('blur'));
    expect(document.querySelector('.nv-tip')).toBeNull();
  });

  it('is not drawn without the owner’s link: its « Relier » is the copilot’s', () => {
    expect(sync({ state: 'none', accounts: [] }).card).toBeNull();
    expect(sync({ state: 'revoked', accounts: [] }).card).toBeNull();
    expect(sync({ state: 'not-owner', accounts: [] }).card).toBeNull();
  });

  // EXT-19 and V-EXT-16: up to 30 s without a word, every button pale.
  it('says which account is on its way and at which of the two steps', () => {
    const { card } = sync(THREE, { pending: { accountId: ACCOUNT_B, phase: 'reading' } });
    expect(names(card)).toEqual(['Resynchroniser', 'Lecture…', 'Synchroniser']);
    expect([...(card?.querySelectorAll('button') ?? [])].every((one) => one.disabled)).toBe(true);
    // The line of the time left steps aside while the session is on its way.
    expect(row(card, 'Soleil')?.querySelector('.pp-sync__gauge')).toBeNull();
    expect(row(card, 'Soleil')?.querySelector('[role="status"]')?.textContent).toBe('Lecture de l’onglet1/2');
    const sending = sync(THREE, { pending: { accountId: ACCOUNT_B, phase: 'sending' } }).card;
    expect(row(sending, 'Soleil')?.querySelector('.pp-sync__state')?.textContent).toBe('Envoi au CRM2/2');
  });

  it('ticks a session just stored and says until when, with the gesture when Reveal comes first', () => {
    const { card } = sync(
      { state: 'ok', accounts: [LUNE] },
      {
        outcome: {
          kind: 'synced',
          accountId: ACCOUNT_A,
          expiresAt: new Date(2026, 10, 16, 9, 5).toISOString(),
          reconnectFirst: true,
          kept: false,
        },
      },
    );
    expect(card?.querySelector('.pp-sync__check')).not.toBeNull();
    expect(card?.querySelector('.pp-sync__until')?.textContent).toBe('jusqu’à demain 9 h 05');
    expect(card?.querySelector('.pp-sync__gauge.is-fresh')).not.toBeNull();
    expect(card?.querySelector('.pp-sync__advice')?.textContent).toBe(
      'Pour 24 h pleines : reconnecte-toi à Reveal, puis resynchronise.',
    );
  });

  it('puts a failure’s cause and gesture under its own account', () => {
    const { card } = sync(THREE, {
      outcome: { kind: 'failed', accountId: ACCOUNT_C, failure: 'other-member' },
    });
    const fail = row(card, 'Brume')?.querySelector('.pp-sync__fail');
    expect(fail?.getAttribute('role')).toBe('status');
    expect(fail?.querySelector('.pp-sync__cause')?.textContent).toContain('un autre membre');
    expect(fail?.textContent).toContain('Connecte-toi à Reveal avec le');
    // The cause takes the place of the advice: one sentence per account.
    expect(row(card, 'Brume')?.querySelector('.pp-sync__advice')).toBeNull();
    expect(card?.querySelectorAll('.pp-sync__fail')).toHaveLength(1);
  });

  it('names the CRM address that does not answer', () => {
    const { card, actions } = sync({ state: 'unreachable', accounts: [] });
    expect(card?.textContent).toContain('Le CRM ne répond pas à 127.0.0.1:5173.');
    card?.querySelector('button')?.click();
    expect(actions.retry).toHaveBeenCalledOnce();
  });

  // Retour PC du 20/11: a 429 read « Le CRM ne répond pas » while the CRM answered.
  it('says the CRM counts too many tries instead of blaming an outage', () => {
    const { card, actions } = sync({ state: 'busy', accounts: [] });
    expect(card?.textContent).toContain('Trop d’essais d’un coup.');
    expect(card?.textContent).not.toContain('ne répond pas');
    card?.querySelector('button')?.click();
    expect(actions.retry).toHaveBeenCalledOnce();
  });

  it('writes the day and the hour', () => {
    expect(whenOf(new Date(2026, 10, 9, 8, 30))).toBe('le 09/11/2026 à 8 h 30');
    expect(untilOf(new Date(2026, 10, 15, 23, 0), NOW)).toBe('jusqu’à 23 h 00');
    expect(untilOf(new Date(2026, 10, 16, 8, 0), NOW)).toBe('jusqu’à demain 8 h 00');
    // Never « jusqu’à le … » (EXT-03).
    expect(untilOf(new Date(2026, 10, 17, 8, 0), NOW)).toBe('jusqu’au 17/11/2026 à 8 h 00');
  });
});

describe('failureOf', () => {
  it('gives every failure a cause and a gesture, never the old catch-all', () => {
    const failures = [
      'no-session',
      'several',
      'expired',
      'unlinked',
      'revoked',
      'not-owner',
      'other-model',
      'other-member',
      'refused',
      'busy',
      'unreachable',
      'extension',
    ] as const;
    for (const failure of failures) {
      const { cause, gesture } = failureOf(failure, 'crm.test');
      expect(cause.endsWith('.')).toBe(true);
      expect(gesture.endsWith('.')).toBe(true);
    }
    expect(failureOf('refused', 'crm.test').gesture).not.toContain('bien connecté');
  });

  // Retour PC du 19/11: a silent worker after a reload read « Le CRM ne répond pas » while the CRM answered.
  it('never blames the CRM for the extension’s own silence, and says how to reload it', () => {
    const { cause, gesture } = failureOf('extension', 'crm.test');
    expect(cause).not.toContain('CRM');
    expect(gesture).toContain('chrome://extensions');
  });
});

describe('before a session leaves (demande de Sécurité)', () => {
  const confirm = (seen: 'same' | 'other' | 'unknown') =>
    sync(THREE, { confirm: { accountId: ACCOUNT_B, modelId: 'model-essai-7', seen } });

  it('shows the account alone, never the raw model id (EXT-05), « Annuler » first on a first sync', () => {
    const { card, actions } = confirm('unknown');
    const text = card?.textContent ?? '';
    expect(text).toContain('Première synchro de ce compte');
    expect(text).toContain('Soleil (@soleil.noir)');
    expect(text).not.toContain('Lune');
    expect(text).not.toContain('Garde la messagerie Reveal ouverte');
    expect(card?.querySelector('.pp-code')).toBeNull();
    expect(text).not.toContain('model-essai-7');
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

// EXT-05: a tab showing another account's creator is refused before anything leaves, by her name.
describe('a tab that shows another account’s creator', () => {
  it('names her under the account synchronised', () => {
    const { card } = sync(THREE, {
      outcome: { kind: 'failed', accountId: ACCOUNT_B, failure: 'other-account', other: ACCOUNT_A },
    });
    expect(card?.querySelector('.pp-sync__cause')?.textContent).toBe('Cet onglet montre Lune.');
    expect(card?.textContent).not.toContain(ACCOUNT_A);
  });
});

describe('syncWanted', () => {
  it('asks for the one neon when a session is missing or ending, never on a card at rest', () => {
    const view = (accounts: RevealAccounts): SyncView => ({
      accounts,
      outcome: null,
      pending: null,
      confirm: null,
      now: NOW,
      crm: 'crm.test',
    });
    expect(syncWanted(view(THREE))).toBe(true);
    expect(syncWanted(view({ state: 'none', accounts: [] }))).toBe(false);
    expect(syncWanted(view({ state: 'ok', accounts: [LUNE] }))).toBe(false);
    expect(syncWanted(view({ state: 'unreachable', accounts: [] }))).toBe(false);
    expect(syncWanted(null)).toBe(false);
  });
});
