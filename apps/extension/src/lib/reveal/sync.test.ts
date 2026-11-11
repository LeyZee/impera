import { PlatformAccountIdSchema } from '@impera/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RevealSession } from './capture';
import { captureSession, syncReveal, type RequestTap, type SeenRequest, type SyncDeps } from './sync';

// Invented values (ADR 0010).
const BEARER = 'invented-bearer-0123456789abcdef';
const AUTH = [{ name: 'Authorization', value: `Bearer ${BEARER}` }];
const ACCOUNT = PlatformAccountIdSchema.parse('7c1e2b3a-4d5f-4a6b-8c7d-9e0f1a2b3c4d');
const NOW = new Date('2026-11-11T15:00:00.000Z');
const FRAME = { userAgent: 'Mozilla/5.0 test', now: () => NOW };
const TIMING = { nudgeMs: 4_000, waitMs: 30_000 };

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

  it('composes the session from the tab’s requests, then stops listening', async () => {
    const tap = fakeTap();
    const captured = captureSession(tap, 7, FRAME, TIMING);
    expect(tap.listen).toHaveBeenCalledWith(7, expect.any(Function));
    tap.emit({ url: 'https://api.reveal.me/models/model-a1', requestHeaders: AUTH });
    tap.emit({ url: 'https://api.reveal.me/users/member-b2/notifications', requestHeaders: AUTH });
    expect(await captured).toEqual({
      v: 1,
      bearer: BEARER,
      userId: 'member-b2',
      modelId: 'model-a1',
      userAgent: FRAME.userAgent,
      capturedAt: NOW.toISOString(),
    });
    expect(tap.listening()).toBe(false);
    expect(tap.reload).not.toHaveBeenCalled();
  });

  it('reloads a quiet tab once, then gives up', async () => {
    const tap = fakeTap();
    const captured = captureSession(tap, 7, FRAME, TIMING);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(tap.reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(26_000);
    expect(await captured).toBeNull();
    expect(tap.listening()).toBe(false);
    expect(tap.reload).toHaveBeenCalledTimes(1);
  });
});

describe('syncReveal', () => {
  const SESSION: RevealSession = {
    v: 1,
    bearer: BEARER,
    userId: 'member-b2',
    modelId: 'model-a1',
    userAgent: FRAME.userAgent,
    capturedAt: NOW.toISOString(),
  };

  function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
    return {
      readLink: () => Promise.resolve('x'.repeat(43)),
      markRevoked: vi.fn(() => Promise.resolve()),
      origin: () => Promise.resolve('http://localhost:5173'),
      capture: () => Promise.resolve(SESSION),
      send: vi.fn(() => Promise.resolve('synced' as const)),
      ...overrides,
    };
  }

  it('sends the captured session for the chosen account', async () => {
    const run = deps();
    expect(await syncReveal(run, ACCOUNT)).toEqual({ state: 'synced' });
    expect(run.send).toHaveBeenCalledWith('http://localhost:5173', 'x'.repeat(43), ACCOUNT, SESSION);
  });

  it('captures nothing without a link, and sends nothing without a session', async () => {
    const capture = vi.fn(() => Promise.resolve(SESSION));
    expect(await syncReveal(deps({ readLink: () => Promise.resolve(null), capture }), ACCOUNT)).toEqual({
      state: 'unlinked',
    });
    expect(capture).not.toHaveBeenCalled();
    const run = deps({ capture: () => Promise.resolve(null) });
    expect(await syncReveal(run, ACCOUNT)).toEqual({ state: 'no-session' });
    expect(run.send).not.toHaveBeenCalled();
  });

  it('drops a link the CRM removed', async () => {
    const run = deps({ send: () => Promise.resolve('revoked' as const) });
    expect(await syncReveal(run, ACCOUNT)).toEqual({ state: 'revoked' });
    expect(run.markRevoked).toHaveBeenCalledTimes(1);
  });
});
