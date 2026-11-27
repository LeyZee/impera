// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHold, type HoldResult } from './Hold';

afterEach(() => {
  cleanup();
});

const leaving = (): Event => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('a held write (EQ-03)', () => {
  it('asks before the page goes away while something is held, not otherwise (CHAT-02)', () => {
    const { result } = renderHook(() => useHold());
    expect(leaving().defaultPrevented).toBe(false);
    const run = vi.fn((): Promise<HoldResult> =>
      Promise.resolve({ ok: true, title: 'Rapport envoyé', text: '' }),
    );
    act(() => {
      result.current.hold({ title: 'Envoi du rapport', text: '120 €' }, run);
    });
    expect(leaving().defaultPrevented).toBe(true);
    act(() => {
      result.current.cancel();
    });
    expect(leaving().defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('still sends what is held as the page goes away', () => {
    const { result } = renderHook(() => useHold());
    const run = vi.fn((): Promise<HoldResult> =>
      Promise.resolve({ ok: true, title: 'Rapport envoyé', text: '' }),
    );
    act(() => {
      result.current.hold({ title: 'Envoi du rapport', text: '120 €' }, run);
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(leaving().defaultPrevented).toBe(false);
  });
});
