// @vitest-environment jsdom
import { CreatorIdSchema } from '@nirvana/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { followCreator, followedOf, useFollowedCreatorId } from './followed';

const LEA = {
  id: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1'),
  displayName: 'Léa',
  timezone: 'Europe/Paris',
};
const ANA = {
  id: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c2'),
  displayName: 'Ana',
  timezone: 'Europe/Paris',
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('followedOf', () => {
  it('is the creator chosen, or the first while none is chosen or the chosen one is gone', () => {
    expect(followedOf([ANA, LEA], LEA.id)).toBe(LEA);
    expect(followedOf([ANA, LEA], null)).toBe(ANA);
    expect(followedOf([ANA], LEA.id)).toBe(ANA);
    expect(followedOf([], LEA.id)).toBeUndefined();
  });
});

describe('useFollowedCreatorId', () => {
  it('shares one choice between every reader, kept on the device', () => {
    const first = renderHook(() => useFollowedCreatorId());
    const second = renderHook(() => useFollowedCreatorId());
    expect(first.result.current.chosen).toBeNull();
    act(() => {
      first.result.current.follow(LEA.id);
    });
    expect(second.result.current.chosen).toBe(LEA.id);
    expect(localStorage.getItem('nirvana.followed-creator')).toBe(LEA.id);
  });

  it('keeps the choice in memory when the browser refuses its storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useFollowedCreatorId());
    expect(result.current.chosen).toBeNull();
    act(() => {
      followCreator(ANA.id);
    });
    expect(result.current.chosen).toBe(ANA.id);
  });
});
