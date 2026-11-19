import { describe, expect, it } from 'vitest';

import { middleCut, sameWords } from './model';

describe('middleCut', () => {
  it('shows a short address whole, without its scheme', () => {
    expect(middleCut('https://liens.example.test/nora')).toBe('liens.example.test/nora');
  });

  it('cuts a long address in its middle and keeps both ends', () => {
    const cut = middleCut('https://liens.example.test/nora/story-du-jour/novembre-2026', 30);
    expect(cut).toHaveLength(30);
    expect(cut.startsWith('liens.example.t')).toBe(true);
    expect(cut.endsWith('novembre-2026')).toBe(true);
    expect(cut).toContain('…');
  });
});

describe('sameWords', () => {
  it('reads two labels as the same whatever their case and outer spaces', () => {
    expect(sameWords(' story du JOUR ', 'Story du jour')).toBe(true);
    expect(sameWords('Lien de novembre', 'Story du jour')).toBe(false);
  });
});
