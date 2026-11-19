// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFollowedCreatorId } from './followed';
import { scopedOf, scopeTo, useCreatorScope } from './scope';

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
  act(() => {
    scopeTo(null);
  });
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('scopedOf', () => {
  it('is the creator chosen, and « Toutes » while none is chosen or the chosen one is gone', () => {
    expect(scopedOf([ANA, LEA], LEA.id)).toBe(LEA);
    expect(scopedOf([ANA, LEA], null)).toBeNull();
    expect(scopedOf([ANA], LEA.id)).toBeNull();
  });
});

describe('useCreatorScope', () => {
  it('starts on « Toutes » and shares one choice between every reader, kept on the device', () => {
    const first = renderHook(() => useCreatorScope());
    const second = renderHook(() => useCreatorScope());
    expect(first.result.current.chosen).toBeNull();
    act(() => {
      first.result.current.choose(LEA.id);
    });
    expect(second.result.current.chosen).toBe(LEA.id);
    expect(localStorage.getItem('impera.creator-scope')).toBe(LEA.id);
    act(() => {
      second.result.current.choose(null);
    });
    expect(first.result.current.chosen).toBeNull();
    expect(localStorage.getItem('impera.creator-scope')).toBe('all');
  });

  it('makes the creator chosen the one followed, and leaves her followed on « Toutes »', () => {
    const followed = renderHook(() => useFollowedCreatorId());
    act(() => {
      scopeTo(ANA.id);
    });
    expect(followed.result.current.chosen).toBe(ANA.id);
    act(() => {
      scopeTo(null);
    });
    expect(followed.result.current.chosen).toBe(ANA.id);
  });

  it('keeps the choice for the tab when the browser refuses its storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('refused');
    });
    const reader = renderHook(() => useCreatorScope());
    act(() => {
      reader.result.current.choose(LEA.id);
    });
    expect(reader.result.current.chosen).toBe(LEA.id);
  });
});
