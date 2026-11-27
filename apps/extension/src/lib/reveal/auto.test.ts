import { PlatformAccountIdSchema, type ConnectorAccountChoice } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { syncAtOpening, type AutoDeps } from './auto';
import type { Captured, RevealSession } from './capture';

// Invented values (ADR 0010).
const LUNE = PlatformAccountIdSchema.parse('7c1e2b3a-4d5f-4a6b-8c7d-9e0f1a2b3c4d');
const ESSAI = PlatformAccountIdSchema.parse('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
const SESSION: RevealSession = {
  v: 1,
  bearer: 'invented-bearer-0123456789abcdef',
  userId: 'member-essai',
  modelId: 'model-lune',
  userAgent: 'Mozilla/5.0 test',
  capturedAt: '2026-11-21T08:00:00.000Z',
};

function account(id: typeof LUNE, over: Partial<ConnectorAccountChoice> = {}): ConnectorAccountChoice {
  return {
    id,
    platform: 'reveal',
    handle: 'lune_essai',
    creatorName: 'Lune',
    sessionState: 'warning',
    sessionUpdatedAt: '2026-11-20T08:00:00.000Z',
    modelId: 'model-lune',
    ...over,
  };
}

function deps(
  accounts: ConnectorAccountChoice[],
  captured: Captured | null = { state: 'session', session: SESSION },
) {
  const capture = vi.fn<AutoDeps['capture']>(() => Promise.resolve(captured));
  const send = vi.fn(() =>
    Promise.resolve({
      state: 'synced' as const,
      stored: { expiresAt: '2026-11-22T08:00:00.000Z', reconnectFirst: false, kept: false },
    }),
  );
  const remember = vi.fn(() => Promise.resolve());
  const markRevoked = vi.fn(() => Promise.resolve());
  const built: AutoDeps = {
    readLink: () => Promise.resolve('A'.repeat(43)),
    origin: () => Promise.resolve('https://crm.example.test'),
    accounts: () => Promise.resolve({ kind: 'ok', value: { accounts } }),
    capture,
    send,
    markRevoked,
    remember,
  };
  return { built, capture, send, remember, markRevoked };
}

describe('the sync at the opening of the popup (ADR 0147)', () => {
  it('sends the session of the one due account the tab names, said as « open », and remembers its model', async () => {
    const { built, capture, send, remember } = deps([
      account(LUNE),
      account(ESSAI, { modelId: 'model-autre', sessionState: 'valid' }),
    ]);
    expect(await syncAtOpening(built)).toEqual({
      state: 'synced',
      accountId: LUNE,
      expiresAt: '2026-11-22T08:00:00.000Z',
      reconnectFirst: false,
      kept: false,
    });
    expect(capture).toHaveBeenCalledWith('model-lune');
    expect(send).toHaveBeenCalledWith('https://crm.example.test', 'A'.repeat(43), LUNE, SESSION, 'open');
    expect(remember).toHaveBeenCalledWith(LUNE, 'model-lune');
  });

  it('reads nothing when no session is over or ending soon, or the account was never synced by hand', async () => {
    for (const accounts of [
      [account(LUNE, { sessionState: 'valid' })],
      [account(LUNE, { sessionState: 'expired', modelId: null })],
      [account(LUNE, { sessionState: 'none', modelId: undefined })],
    ]) {
      const { built, capture } = deps(accounts);
      expect(await syncAtOpening(built)).toEqual({ state: 'idle' });
      expect(capture).not.toHaveBeenCalled();
    }
  });

  it('does nothing without a link, or for a link that is not the owner’s', async () => {
    const unlinked = deps([account(LUNE)]);
    expect(await syncAtOpening({ ...unlinked.built, readLink: () => Promise.resolve(null) })).toEqual({
      state: 'idle',
    });
    const manager = deps([account(LUNE)]);
    const refused = {
      ...manager.built,
      accounts: () => Promise.resolve({ kind: 'refused' as const, code: 'connector_link_forbidden' }),
    };
    expect(await syncAtOpening(refused)).toEqual({ state: 'idle' });
    expect(manager.capture).not.toHaveBeenCalled();
  });

  it('sends nothing when the tab names another model, a model of two accounts, or a session not due', async () => {
    const other = deps([account(LUNE)], {
      state: 'session',
      session: { ...SESSION, modelId: 'model-inconnue' },
    });
    expect(await syncAtOpening(other.built)).toEqual({ state: 'idle' });
    expect(other.send).not.toHaveBeenCalled();

    const twice = deps([account(LUNE), account(ESSAI)]);
    expect(await syncAtOpening(twice.built)).toEqual({ state: 'idle' });
    expect(twice.capture).toHaveBeenCalledWith(null);
    expect(twice.send).not.toHaveBeenCalled();

    const notDue = deps([
      account(LUNE, { modelId: 'model-autre' }),
      account(ESSAI, { sessionState: 'valid' }),
    ]);
    expect(await syncAtOpening(notDue.built)).toEqual({ state: 'idle' });
    expect(notDue.send).not.toHaveBeenCalled();
  });

  it('says nothing when the tab named several creators or nothing in time', async () => {
    for (const captured of [{ state: 'several' } as const, null]) {
      const { built, send } = deps([account(LUNE)], captured);
      expect(await syncAtOpening(built)).toEqual({ state: 'idle' });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('keeps quiet on a refusal, and marks a revoked link', async () => {
    const { built, markRevoked, remember } = deps([account(LUNE)]);
    const revoked = { ...built, send: () => Promise.resolve({ state: 'revoked' as const }) };
    expect(await syncAtOpening(revoked)).toEqual({ state: 'idle' });
    expect(markRevoked).toHaveBeenCalledOnce();
    expect(remember).not.toHaveBeenCalled();
  });
});
