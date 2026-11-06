import { afterEach, describe, expect, it, vi } from 'vitest';

import { chosenPassword, forgetChosenPassword, holdChosenPassword } from './chosen-password';

describe('the password just chosen (recette SEC-15)', () => {
  afterEach(() => {
    forgetChosenPassword();
    vi.useRealTimers();
  });

  it('is forgotten after two minutes even if nothing reads it', () => {
    vi.useFakeTimers();
    holdChosenPassword('un mot de passe choisi');
    expect(chosenPassword()).toBe('un mot de passe choisi');
    vi.advanceTimersByTime(2 * 60_000);
    // Read far in the past: only the timer can have forgotten it.
    expect(chosenPassword(0)).toBeNull();
  });
});
