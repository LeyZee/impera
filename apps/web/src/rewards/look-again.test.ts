// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lookAgainAtHerCase } from './api';

afterEach(() => {
  vi.useRealTimers();
});

describe('her case read again after her gesture (recette 16/11, CRE-06)', () => {
  it('reads her case again once the game has looked, then once more for a busy worker', () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    lookAgainAtHerCase(client);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['rewards', 'creator-space', 'trophy-case'] });
    vi.advanceTimersByTime(8_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
