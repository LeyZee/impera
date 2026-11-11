// @vitest-environment jsdom
import { PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { RevealAccounts } from '../../lib/watch/protocol';

import { syncCard, syncWanted, whenOf, type SyncActions, type SyncView } from './reveal-view';

// Invented accounts (ADR 0010).
const ACCOUNT_A = PlatformAccountIdSchema.parse('7c1e2b3a-4d5f-4a6b-8c7d-9e0f1a2b3c4d');
const ACCOUNT_B = PlatformAccountIdSchema.parse('8d2f3c4b-5e6a-4b7c-9d8e-0f1a2b3c4d5e');
const NOW = new Date(2026, 10, 11, 15, 0);

function draw(
  accounts: RevealAccounts,
  overrides: Partial<SyncView> = {},
): { card: HTMLElement | null; actions: SyncActions } {
  const actions: SyncActions = { link: vi.fn(), sync: vi.fn(), retry: vi.fn(), openSecurity: vi.fn() };
  const view: SyncView = { accounts, notice: null, busy: false, draft: '', now: NOW, ...overrides };
  return { card: syncCard(view, actions), actions };
}

const TWO: RevealAccounts = {
  state: 'ok',
  accounts: [
    {
      id: ACCOUNT_A,
      handle: 'atelier.lune',
      creatorName: 'Lune',
      sessionState: 'valid',
      sessionUpdatedAt: new Date(2026, 10, 11, 9, 5).toISOString(),
    },
    {
      id: ACCOUNT_B,
      handle: 'soleil.noir',
      creatorName: 'Soleil',
      sessionState: 'expired',
      sessionUpdatedAt: null,
    },
  ],
};

describe('the « Sync » card on a Reveal tab', () => {
  it('lists each Reveal account with its session and a button that syncs that one', () => {
    const { card, actions } = draw(TWO);
    const text = card?.textContent ?? '';
    expect(text).toContain('Lune');
    expect(text).toContain('Session valide, envoyée aujourd’hui à 9 h 05.');
    expect(text).toContain('Session expirée');
    expect(text).toContain('À synchroniser');
    const buttons = [...(card?.querySelectorAll('button') ?? [])];
    expect(buttons).toHaveLength(2);
    buttons[1]?.click();
    expect(actions.sync).toHaveBeenCalledWith(ACCOUNT_B);
  });

  it('asks for the link first, and says when the CRM removed it', () => {
    expect(draw({ state: 'none', accounts: [] }).card?.querySelector('form')).not.toBeNull();
    expect(draw({ state: 'revoked', accounts: [] }).card?.textContent).toContain('retirée dans le CRM');
  });

  it('is not drawn for a link that is not the owner’s', () => {
    expect(draw({ state: 'not-owner', accounts: [] }).card).toBeNull();
  });

  it('waits while a « Sync » is on its way, and draws no native select', () => {
    const { card } = draw(TWO, { busy: true });
    expect([...(card?.querySelectorAll('button') ?? [])].every((button) => button.disabled)).toBe(true);
    expect(card?.querySelector('select')).toBeNull();
  });

  it('writes the day only when it is not today', () => {
    expect(whenOf(new Date(2026, 10, 9, 8, 30), NOW)).toBe('le 9/11 à 8 h 30');
  });
});

describe('syncWanted', () => {
  it('asks for the one neon when a link or a session is missing, never on a card at rest', () => {
    const view = (accounts: RevealAccounts): SyncView => ({
      accounts,
      notice: null,
      busy: false,
      draft: '',
      now: NOW,
    });
    expect(syncWanted(view(TWO))).toBe(true);
    expect(syncWanted(view({ state: 'none', accounts: [] }))).toBe(true);
    expect(syncWanted(view({ state: 'ok', accounts: TWO.accounts.slice(0, 1) }))).toBe(false);
    expect(syncWanted(view({ state: 'unreachable', accounts: [] }))).toBe(false);
    expect(syncWanted(null)).toBe(false);
  });
});
