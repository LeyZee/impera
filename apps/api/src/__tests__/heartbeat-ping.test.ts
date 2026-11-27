import { describe, expect, it, vi } from 'vitest';

import { createHeartbeatPing } from '../heartbeat-ping';

const URL_WITH_SECRET = 'https://watcher.example.test/ping/not-a-real-check-id';

function harness(answer: () => Promise<{ ok: boolean }>) {
  let clock = 0;
  const warn = vi.fn();
  const fetch = vi.fn((url: string, init: { readonly signal: AbortSignal }) =>
    url === '' || init.signal.aborted ? Promise.reject(new Error('unused')) : answer(),
  );
  const ping = createHeartbeatPing(
    URL_WITH_SECRET,
    { warn },
    { fetch, now: () => clock, minIntervalMs: 60_000 },
  );
  return {
    ping,
    fetch,
    warn,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('createHeartbeatPing (OPS-22)', () => {
  it('pings the watcher, then at most once a minute', async () => {
    const h = harness(() => Promise.resolve({ ok: true }));
    await h.ping();
    h.advance(30_000);
    await h.ping();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0]?.[0]).toBe(URL_WITH_SECRET);
    h.advance(30_000);
    await h.ping();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('never throws, and never logs the address, when the watcher fails or refuses', async () => {
    const failing = harness(() => Promise.reject(new TypeError(`fetch failed for ${URL_WITH_SECRET}`)));
    await expect(failing.ping()).resolves.toBeUndefined();
    const refusing = harness(() => Promise.resolve({ ok: false }));
    await expect(refusing.ping()).resolves.toBeUndefined();
    for (const { warn } of [failing, refusing]) {
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('not-a-real-check-id');
    }
  });

  it('tries again a minute after a failure, not before', async () => {
    const h = harness(() => Promise.reject(new Error('down')));
    await h.ping();
    h.advance(10_000);
    await h.ping();
    h.advance(50_000);
    await h.ping();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds each ping in time', async () => {
    const h = harness(() => Promise.resolve({ ok: true }));
    await h.ping();
    expect(h.fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
});
