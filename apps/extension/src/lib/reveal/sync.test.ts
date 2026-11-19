import { PlatformAccountIdSchema } from '@impera/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Captured, RevealSession } from './capture';
import {
  captureSession,
  readReveal,
  sendHeld,
  sessionHold,
  type ReadDeps,
  type RequestTap,
  type SeenRequest,
  type SendDeps,
} from './sync';

// Invented values (ADR 0010).
const BEARER = 'invented-bearer-0123456789abcdef';
const AUTH = [{ name: 'Authorization', value: `Bearer ${BEARER}` }];
const ACCOUNT = PlatformAccountIdSchema.parse('7c1e2b3a-4d5f-4a6b-8c7d-9e0f1a2b3c4d');
const NOW = new Date('2026-11-11T15:00:00.000Z');
const FRAME = { userAgent: 'Mozilla/5.0 test', now: () => NOW };
const TIMING = { nudgeMs: 4_000, waitMs: 30_000, settleMs: 2_500 };

function fakeTap(): RequestTap & { emit: (request: SeenRequest) => void; listening: () => boolean } {
  let current: ((request: SeenRequest) => void) | null = null;
  return {
    listen: vi.fn((_tabId: number, listener: (request: SeenRequest) => void) => {
      current = listener;
    }),
    stop: vi.fn(() => {
      current = null;
    }),
    reload: vi.fn(),
    emit: (request) => current?.(request),
    listening: () => current !== null,
  };
}

describe('captureSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('composes the session as soon as the account’s model shows, then stops listening', async () => {
    const tap = fakeTap();
    const captured = captureSession(tap, 7, 'model-a1', FRAME, TIMING);
    expect(tap.listen).toHaveBeenCalledWith(7, expect.any(Function));
    tap.emit({ url: 'https://api.reveal.me/models/model-a1', requestHeaders: AUTH });
    tap.emit({ url: 'https://api.reveal.me/users/member-b2/notifications', requestHeaders: AUTH });
    expect(await captured).toEqual({
      state: 'session',
      session: {
        v: 1,
        bearer: BEARER,
        userId: 'member-b2',
        modelId: 'model-a1',
        userAgent: FRAME.userAgent,
        capturedAt: NOW.toISOString(),
      },
    });
    expect(tap.listening()).toBe(false);
    expect(tap.reload).not.toHaveBeenCalled();
  });

  // 19/11: the tab named another creator first, and the CRM refused the session (409).
  it('keeps listening past another creator until the account’s model shows', async () => {
    const tap = fakeTap();
    const captured = captureSession(tap, 7, 'model-a1', FRAME, TIMING);
    tap.emit({ url: 'https://api.reveal.me/users/member-b2/x?modelId=model-z9', requestHeaders: AUTH });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tap.listening()).toBe(true);
    tap.emit({ url: 'https://api.reveal.me/models/model-a1', requestHeaders: AUTH });
    const result = await captured;
    expect(result?.state === 'session' ? result.session.modelId : result).toBe('model-a1');
  });

  it('settles on the only creator seen, or says several, when the account’s does not show', async () => {
    const alone = fakeTap();
    const one = captureSession(alone, 7, 'model-a1', FRAME, TIMING);
    alone.emit({ url: 'https://api.reveal.me/users/member-b2/x?modelId=model-z9', requestHeaders: AUTH });
    await vi.advanceTimersByTimeAsync(2_500);
    const result = await one;
    expect(result?.state === 'session' ? result.session.modelId : result).toBe('model-z9');

    const crowd = fakeTap();
    const several = captureSession(crowd, 7, null, FRAME, TIMING);
    crowd.emit({ url: 'https://api.reveal.me/users/member-b2/x?modelId=model-z9', requestHeaders: AUTH });
    crowd.emit({ url: 'https://api.reveal.me/models/model-y8', requestHeaders: AUTH });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await several).toEqual({ state: 'several' });
    expect(crowd.listening()).toBe(false);
  });

  it('reloads a quiet tab once, then gives up', async () => {
    const tap = fakeTap();
    const captured = captureSession(tap, 7, null, FRAME, TIMING);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(tap.reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(26_000);
    expect(await captured).toBeNull();
    expect(tap.listening()).toBe(false);
    expect(tap.reload).toHaveBeenCalledTimes(1);
  });
});

describe('the session read, held, then sent', () => {
  const SESSION: RevealSession = {
    v: 1,
    bearer: BEARER,
    userId: 'member-b2',
    modelId: 'model-a1',
    userAgent: FRAME.userAgent,
    capturedAt: NOW.toISOString(),
  };
  const OTHER = PlatformAccountIdSchema.parse('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function reading(overrides: Partial<ReadDeps> = {}): ReadDeps {
    return {
      readLink: () => Promise.resolve('x'.repeat(43)),
      capture: () => Promise.resolve({ state: 'session', session: SESSION }),
      expectedModel: () => Promise.resolve(null),
      ...overrides,
    };
  }

  function sending(overrides: Partial<SendDeps> = {}): SendDeps {
    return {
      readLink: () => Promise.resolve('x'.repeat(43)),
      markRevoked: vi.fn(() => Promise.resolve()),
      origin: () => Promise.resolve('http://localhost:5173'),
      send: vi.fn(() =>
        Promise.resolve({
          state: 'synced' as const,
          stored: { expiresAt: '2026-11-12T09:05:00.000Z', reconnectFirst: false, kept: false },
        }),
      ),
      remember: vi.fn(() => Promise.resolve()),
      ...overrides,
    };
  }

  it('tells the popup the model alone, and sends only on confirmation', async () => {
    const hold = sessionHold();
    const read = await readReveal(reading(), hold, ACCOUNT);
    expect(read).toEqual({ state: 'held', modelId: 'model-a1', seen: 'unknown' });
    expect(JSON.stringify(read)).not.toContain(BEARER);
    const run = sending();
    expect(await sendHeld(run, hold, ACCOUNT)).toEqual({
      state: 'synced',
      expiresAt: '2026-11-12T09:05:00.000Z',
      reconnectFirst: false,
      kept: false,
    });
    expect(run.send).toHaveBeenCalledWith('http://localhost:5173', 'x'.repeat(43), ACCOUNT, SESSION);
    expect(run.remember).toHaveBeenCalledWith(ACCOUNT, 'model-a1');
    // Taken once: a second « Envoyer » finds nothing.
    expect(await sendHeld(run, hold, ACCOUNT)).toEqual({ state: 'expired' });
  });

  it('reads for the account’s model, and says several creators without holding anything', async () => {
    const capture = vi.fn<ReadDeps['capture']>(() => Promise.resolve({ state: 'several' }));
    const hold = sessionHold();
    const read = await readReveal(
      reading({ expectedModel: () => Promise.resolve('model-a1'), capture }),
      hold,
      ACCOUNT,
    );
    expect(capture).toHaveBeenCalledWith('model-a1');
    expect(read).toEqual({ state: 'several' });
    expect(await sendHeld(sending(), hold, ACCOUNT)).toEqual({ state: 'expired' });
  });

  it('compares the model with the account’s', async () => {
    const same = await readReveal(
      reading({ expectedModel: () => Promise.resolve('model-a1') }),
      sessionHold(),
      ACCOUNT,
    );
    expect(same).toMatchObject({ seen: 'same' });
    const other = await readReveal(
      reading({ expectedModel: () => Promise.resolve('model-z9') }),
      sessionHold(),
      ACCOUNT,
    );
    expect(other).toMatchObject({ seen: 'other' });
  });

  it('forgets the session after a minute, on cancel, and for another account', async () => {
    const hold = sessionHold();
    await readReveal(reading(), hold, ACCOUNT);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await sendHeld(sending(), hold, ACCOUNT)).toEqual({ state: 'expired' });
    await readReveal(reading(), hold, ACCOUNT);
    hold.drop();
    expect(await sendHeld(sending(), hold, ACCOUNT)).toEqual({ state: 'expired' });
    await readReveal(reading(), hold, ACCOUNT);
    const run = sending();
    expect(await sendHeld(run, hold, OTHER)).toEqual({ state: 'expired' });
    expect(await sendHeld(run, hold, ACCOUNT)).toEqual({ state: 'expired' });
    expect(run.send).not.toHaveBeenCalled();
  });

  it('reads nothing without a link, and holds nothing without a session', async () => {
    const capture = vi.fn(() => Promise.resolve<Captured>({ state: 'session', session: SESSION }));
    const hold = sessionHold();
    expect(
      await readReveal(reading({ readLink: () => Promise.resolve(null), capture }), hold, ACCOUNT),
    ).toEqual({
      state: 'unlinked',
    });
    expect(capture).not.toHaveBeenCalled();
    expect(await readReveal(reading({ capture: () => Promise.resolve(null) }), hold, ACCOUNT)).toEqual({
      state: 'no-session',
    });
    expect(await sendHeld(sending(), hold, ACCOUNT)).toEqual({ state: 'expired' });
  });

  it('drops a link the CRM removed, and remembers no model it refused', async () => {
    const hold = sessionHold();
    await readReveal(reading(), hold, ACCOUNT);
    const run = sending({ send: () => Promise.resolve({ state: 'revoked' as const }) });
    expect(await sendHeld(run, hold, ACCOUNT)).toEqual({ state: 'revoked' });
    expect(run.markRevoked).toHaveBeenCalledTimes(1);
    expect(run.remember).not.toHaveBeenCalled();
  });
});
